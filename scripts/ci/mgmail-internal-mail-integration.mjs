import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ownerEmail = process.env.TEST_EMAIL;
const ownerPassword = process.env.TEST_PASSWORD;
if (!url || !anonKey || !serviceKey || !ownerEmail || !ownerPassword) {
  throw new Error("Environnement MGMail d'intégration isolée incomplet.");
}

const client = (key) => createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const admin = client(serviceKey);
const owner = client(anonKey);
const auth = await owner.auth.signInWithPassword({
  email: ownerEmail, password: ownerPassword,
});
if (auth.error || !auth.data.user) throw auth.error || new Error("Connexion propriétaire impossible.");
const ownerId = auth.data.user.id;

const membership = await admin.from("organization_members").select("organization_id")
  .eq("user_id", ownerId).eq("status", "active").limit(1).single();
if (membership.error) throw membership.error;
const organizationId = membership.data.organization_id;

const assert = (value, message) => { if (!value) throw new Error(message); };
const required = (response, label) => {
  if (response.error) throw new Error(`${label} : ${response.error.message}`);
  return response.data;
};
const denied = (response, label) => {
  if (!response.error && Array.isArray(response.data) && response.data.length === 0) return;
  assert(!!response.error, `${label} : une action interdite a été autorisée.`);
  assert(response.error.code === "42501",
    `${label} : erreur inattendue ${response.error.code} au lieu d'un refus RLS.`);
};

const suffix = randomUUID().slice(0, 8);
const namespace = `mgmail-ci-${suffix}`;
const ns = required(await owner.from("mgmail_internal_namespaces")
  .insert({ organization_id: organizationId, slug: namespace }).select("slug").single(), "Namespace");
assert(ns.slug === namespace, "Identifiant entreprise MGMail non enregistré.");

async function createCollaborator(role) {
  const email = `mgmail-${role}-${randomUUID().slice(0, 8)}@magnisa.test`;
  const password = `MG-${randomBytes(18).toString("hex")}!a9`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw created.error || new Error("Création du collaborateur impossible.");
  const userId = created.data.user.id;
  required(await admin.from("organization_members").insert({
    organization_id: organizationId, user_id: userId, role, status: "active",
  }), "Adhésion entreprise");
  const userClient = client(anonKey);
  const signedIn = await userClient.auth.signInWithPassword({ email, password });
  if (signedIn.error || signedIn.data.user?.id !== userId) throw signedIn.error || new Error("Connexion collaborateur impossible.");
  return { userClient, userId };
}
const a = await createCollaborator("employee");
const b = await createCollaborator("employee");

const mailbox = async (localPart, ownerIdValue) =>
  required(await owner.from("mgmail_internal_mailboxes").insert({
    organization_id: organizationId, local_part: localPart, owner_user_id: ownerIdValue,
  }).select("id").single(), `Boîte ${localPart}`).id;

const finance = await mailbox(`finance-${suffix}`, a.userId);
const direction = await mailbox(`direction-${suffix}`, b.userId);
const ownerBox = await mailbox(`direction-admin-${suffix}`, ownerId);

// L'employé ne peut pas attribuer une nouvelle boîte à un collègue.
denied(await a.userClient.from("mgmail_internal_mailboxes").insert({
  organization_id: organizationId, local_part: `usurpation-${suffix}`, owner_user_id: a.userId,
}).select("id"), "Création non autorisée d'une boîte");

// Vérifier d'abord que les membres et leurs boîtes sont effectivement visibles
// dans le contexte JWT utilisateur, avant de tester l'insertion d'un message.
const senderVisible = required(await a.userClient
  .from("mgmail_internal_mailboxes")
  .select("id,owner_user_id,is_active,can_read,can_send")
  .eq("organization_id", organizationId).eq("id", finance), "Boîte expéditeur");
const recipientVisible = required(await a.userClient
  .from("mgmail_internal_mailboxes")
  .select("id,owner_user_id,is_active,can_read,can_send")
  .eq("organization_id", organizationId).eq("id", direction), "Boîte destinataire");
const ownMembership = required(await a.userClient.from("organization_members")
  .select("user_id,status").eq("organization_id", organizationId)
  .eq("user_id", a.userId), "Appartenance de l'expéditeur");
assert(senderVisible.length === 1 && senderVisible[0].owner_user_id === a.userId
  && senderVisible[0].can_send && senderVisible[0].can_read, "Boîte expéditeur inaccessible");
assert(recipientVisible.length === 1 && recipientVisible[0].owner_user_id === b.userId
  && recipientVisible[0].is_active, "Boîte destinataire inaccessible");
assert(ownMembership.length === 1 && ownMembership[0].status === "active",
  "Adhésion du collaborateur non visible");
const allowedSend = required(await a.userClient.rpc("mgmail_can_send_internal", {
  p_organization_id: organizationId,
  p_sender_mailbox_id: finance,
  p_recipient_mailbox_id: direction,
}), "Permission interne d'envoi");
assert(allowedSend === true, "La permission MGMail doit autoriser l'envoi d'un collaborateur actif.");

const forbiddenSend = required(await a.userClient.rpc("mgmail_can_send_internal", {
  p_organization_id: organizationId,
  p_sender_mailbox_id: direction,
  p_recipient_mailbox_id: finance,
}), "Permission d'usurpation");
assert(forbiddenSend === false, "Un collaborateur ne peut pas utiliser l'adresse d'un collègue.");
// Échanges internes entre deux collaborateurs de la même entreprise.
// Le parcours applicatif utilise INSERT sans RETURNING : vérifier cette voie
// puis récupérer le message par SELECT authentifié et RLS.
required(await a.userClient.from("mgmail_internal_messages").insert({
  organization_id: organizationId, sender_mailbox_id: finance,
  recipient_mailbox_id: direction, subject: "Facture interne MGMail",
  body_text: "Message interne de contrôle, sans fournisseur Google.",
}), "Envoi interne");
const sentMessageRows = required(await a.userClient.from("mgmail_internal_messages")
  .select("id").eq("organization_id", organizationId)
  .eq("sender_mailbox_id", finance).eq("recipient_mailbox_id", direction)
  .eq("subject", "Facture interne MGMail"), "Consultation après envoi");
assert(sentMessageRows.length === 1, "L'expéditeur ne peut pas retrouver le message créé.");
const outgoing = sentMessageRows[0];

// Réception d'une notification personnelle dans MAGNISA (pas d'envoi
// automatique d'e-mail Internet).
const notice = required(await b.userClient.from("notifications")
  .select("id,entity_id,dedupe_key")
  .eq("organization_id", organizationId)
  .eq("recipient_user_id", b.userId)
  .eq("entity_id", outgoing.id), "Notification du destinataire");
assert(notice.length === 1 && notice[0].dedupe_key ===
  `mgmail-internal-message:${outgoing.id}`,
  "Chaque message interne doit créer une seule notification pour son destinataire.");
const otherNotice = required(await a.userClient.from("notifications")
  .select("id")
  .eq("organization_id", organizationId)
  .eq("recipient_user_id", b.userId)
  .eq("entity_id", outgoing.id), "Isolation de notification");
assert(otherNotice.length === 0, "L'expéditeur ne peut pas lire la notification privée d'autrui.");

const initialRead = required(await b.userClient.from("mgmail_internal_messages")
  .select("id,read_at").eq("id", outgoing.id).single(), "État de lecture initial");
assert(initialRead.read_at === null, "Le message doit être non lu lors de sa réception.");
const readResult = required(await b.userClient.from("mgmail_internal_messages")
  .update({ read_at: new Date().toISOString() })
  .eq("id", outgoing.id).select("id,read_at").single(), "Marquage du message comme lu");
assert(!!readResult.read_at, "Le destinataire doit pouvoir marquer son message comme lu.");
const unauthorizedRead = await a.userClient.from("mgmail_internal_messages")
  .update({ read_at: new Date().toISOString() })
  .eq("id", outgoing.id).select("id");
denied(unauthorizedRead, "Un expéditeur ne peut pas marquer le message d'autrui comme lu");

const inboxB = required(await b.userClient.from("mgmail_internal_messages")
  .select("id").eq("id", outgoing.id), "Lecture destinataire");
assert(inboxB.length === 1, "Le collaborateur destinataire ne reçoit pas le message.");

const sentA = required(await a.userClient.from("mgmail_internal_messages")
  .select("id").eq("id", outgoing.id), "Lecture expéditeur");
assert(sentA.length === 1, "L'expéditeur ne retrouve pas son envoyé.");

const inboxAdmin = required(await owner.from("mgmail_internal_messages")
  .select("id").eq("id", outgoing.id), "Confidentialité direction");
assert(inboxAdmin.length === 0, "Un administrateur non destinataire a lu un message privé.");

// Un employé ne peut ni se faire passer pour un collègue ni changer de boîte.
denied(await a.userClient.from("mgmail_internal_messages").insert({
  organization_id: organizationId, sender_mailbox_id: direction,
  recipient_mailbox_id: ownerBox, subject: "Usurpation",
  body_text: "Ce message doit être rejeté.",
}).select("id"), "Usurpation d'expéditeur");

required(await owner.from("mgmail_internal_mailboxes").update({ can_send: false })
  .eq("id", finance).eq("organization_id", organizationId), "Suspension des envois");

denied(await a.userClient.from("mgmail_internal_messages").insert({
  organization_id: organizationId, sender_mailbox_id: finance,
  recipient_mailbox_id: direction, subject: "Envoi interdit",
  body_text: "Le contrôle can_send doit refuser cet envoi.",
}).select("id"), "Envoi sans autorisation");

required(await owner.from("mgmail_internal_mailboxes").update({ can_read: false })
  .eq("id", direction).eq("organization_id", organizationId), "Suspension de lecture");
const blockedInbox = required(await b.userClient.from("mgmail_internal_messages")
  .select("id").eq("id", outgoing.id), "Lecture après révocation");
assert(blockedInbox.length === 0, "La lecture après révocation doit être interdite.");

// Autoriser deux collaborateurs différents sur une même boîte de service.
required(await owner.from("mgmail_internal_mailboxes").update({can_send: true})
  .eq("id",finance).eq("organization_id",organizationId),"Réactivation envoi service");
required(await owner.from("mgmail_internal_mailboxes").update({can_read: true})
  .eq("id",direction).eq("organization_id",organizationId),"Réactivation lecture");
required(await owner.from("mgmail_internal_mailbox_grants").insert({
  organization_id:organizationId,mailbox_id:ownerBox,user_id:a.userId,
  can_read:true,can_send:true,is_active:true,
}),"Partage lecture et envoi");
required(await owner.from("mgmail_internal_mailbox_grants").insert({
  organization_id:organizationId,mailbox_id:ownerBox,user_id:b.userId,
  can_read:true,can_send:false,is_active:true,
}),"Partage en lecture seule");
const permissionA=required(await a.userClient.rpc("mgmail_has_internal_access",{
  p_org:organizationId,p_mailbox:ownerBox,p_action:"send",
}),"Permission envoi déléguée");
const permissionB=required(await b.userClient.rpc("mgmail_has_internal_access",{
  p_org:organizationId,p_mailbox:ownerBox,p_action:"send",
}),"Permission lecteur seul");
assert(permissionA===true && permissionB===false,
  "Les droits de lecture et d'envoi doivent être indépendants.");
required(await a.userClient.from("mgmail_internal_messages").insert({
  organization_id:organizationId,sender_mailbox_id:ownerBox,recipient_mailbox_id:direction,
  subject:"Envoi délégué MGMail",body_text:"Message envoyé avec droit explicite.",
}),"Envoi partagé autorisé");
denied(await b.userClient.from("mgmail_internal_messages").insert({
  organization_id:organizationId,sender_mailbox_id:ownerBox,recipient_mailbox_id:finance,
  subject:"Envoi interdit",body_text:"L'accès lecture ne donne pas le droit d'envoyer.",
}).select("id"),"Envoi refusé à un lecteur seul");
required(await b.userClient.from("mgmail_internal_messages").insert({
  organization_id:organizationId,sender_mailbox_id:direction,recipient_mailbox_id:ownerBox,
  subject:"Réponse à la boîte commune",body_text:"Notification et état de lecture individuel.",
}),"Message reçu dans la boîte commune");
const shared=required(await owner.from("mgmail_internal_messages").select("id")
  .eq("organization_id",organizationId).eq("subject","Réponse à la boîte commune"),
  "Accès propriétaire aux messages partagés");
assert(shared.length===1,"La boîte de service doit recevoir le message.");
const sharedId=shared[0].id;
for(const [recipient,session] of [[ownerId,owner],[a.userId,a.userClient]]) {
  const notice=required(await session.from("notifications").select("id")
    .eq("organization_id",organizationId).eq("recipient_user_id",recipient)
    .eq("entity_id",sharedId),"Notification de boîte partagée");
  assert(notice.length===1,"Chaque lecteur autorisé doit recevoir une notification.");
}
required(await a.userClient.from("mgmail_internal_message_reads").insert({
  organization_id:organizationId,message_id:sharedId,user_id:a.userId,
}),"Lecture personnelle du message partagé");
const mineRead=required(await a.userClient.from("mgmail_internal_message_reads")
  .select("message_id").eq("message_id",sharedId),"Lecture collaborateur");
const ownerRead=required(await owner.from("mgmail_internal_message_reads")
  .select("message_id").eq("message_id",sharedId),"Lecture administrateur");
assert(mineRead.length===1 && ownerRead.length===0,
  "La lecture d'un collaborateur ne doit pas effacer les non-lus d'un autre.");
denied(await b.userClient.from("mgmail_internal_mailbox_grants")
  .update({can_send:true}).eq("organization_id",organizationId)
  .eq("mailbox_id",ownerBox).eq("user_id",b.userId).select("mailbox_id"),
  "Interdiction de modifier ses propres droits");
required(await owner.from("mgmail_internal_mailbox_grants")
  .update({can_read:false,can_send:false,is_active:false})
  .eq("organization_id",organizationId).eq("mailbox_id",ownerBox)
  .eq("user_id",a.userId),"Révocation du partage");
const afterRevoke=required(await a.userClient.rpc("mgmail_has_internal_access",{
  p_org:organizationId,p_mailbox:ownerBox,p_action:"read",
}),"Vérification de la révocation");
assert(afterRevoke===false,"Un accès retiré doit être refusé immédiatement.");
const hiddenShared=required(await a.userClient.from("mgmail_internal_messages")
  .select("id").eq("id",sharedId),"Protection des messages après révocation");
assert(hiddenShared.length===0,"Les messages doivent disparaître après révocation.");

// Une personne hors de l'organisation n'a pas accès au répertoire.
const outsiderEmail = `mgmail-outsider-${suffix}@magnisa.test`;
const outsiderPassword = `MG-${randomBytes(18).toString("hex")}!a9`;
const outsiderCreated = await admin.auth.admin.createUser({
  email: outsiderEmail, password: outsiderPassword, email_confirm: true,
});
if (outsiderCreated.error) throw outsiderCreated.error;
const outsider = client(anonKey);
const outsiderAuth = await outsider.auth.signInWithPassword({
  email: outsiderEmail, password: outsiderPassword,
});
if (outsiderAuth.error) throw outsiderAuth.error;
denied(await outsider.from("mgmail_internal_mailboxes").select("id")
  .eq("organization_id", organizationId), "Répertoire hors organisation");
denied(await outsider.from("mgmail_internal_messages").select("id")
  .eq("organization_id", organizationId), "Messages hors organisation");

// La suspension d'un membre désactive immédiatement ses boîtes.
required(await admin.from("organization_members")
  .update({ status: "suspended" })
  .eq("organization_id", organizationId)
  .eq("user_id", b.userId), "Suspension collaborateur");
const mailboxAfterDeparture = required(await owner.from("mgmail_internal_mailboxes")
  .select("is_active").eq("organization_id", organizationId)
  .eq("id", direction).single(), "Suspension automatique de la boîte");
assert(mailboxAfterDeparture.is_active === false,
  "La boîte d'un collaborateur suspendu doit être désactivée.");
const ownerToDeparted = required(await owner.rpc("mgmail_can_send_internal", {
  p_organization_id: organizationId,
  p_sender_mailbox_id: ownerBox,
  p_recipient_mailbox_id: direction,
}), "Prévention des envois vers un ancien membre");
assert(ownerToDeparted === false,
  "Un collaborateur suspendu ne peut plus recevoir de messages.");
const grantAfterDeparture=required(await owner.from("mgmail_internal_mailbox_grants")
  .select("is_active").eq("organization_id",organizationId)
  .eq("mailbox_id",ownerBox).eq("user_id",b.userId).single(),
  "Délégation du collaborateur suspendu");
assert(grantAfterDeparture.is_active===false,
  "Les délégations doivent être désactivées au départ d'un collaborateur.");

process.stdout.write(
  "PASS MGMail: envoi/réception interne, confidentialité, permissions et isolation des entreprises.\n",
);
