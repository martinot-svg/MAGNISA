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
// Échanges internes entre deux collaborateurs de la même entreprise.
const outgoing = required(await a.userClient.from("mgmail_internal_messages").insert({
  organization_id: organizationId, sender_mailbox_id: finance,
  recipient_mailbox_id: direction, subject: "Facture interne MGMail",
  body_text: "Message interne de contrôle, sans fournisseur Google.",
}).select("id").single(), "Envoi interne");
assert(!!outgoing.id, "Message interne non créé.");

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

process.stdout.write(
  "PASS MGMail: envoi/réception interne, confidentialité, permissions et isolation des entreprises.\n",
);
