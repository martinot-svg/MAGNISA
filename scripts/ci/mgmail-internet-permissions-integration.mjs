import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.TEST_EMAIL;
const password = process.env.TEST_PASSWORD;
if (!url || !key || !service || !email || !password)
  throw new Error("Environnement MGMail Internet isolé incomplet.");
const client = (k) => createClient(url, k, { auth: { autoRefreshToken:false, persistSession:false } });
const admin = client(service);
const owner = client(key);
const auth = await owner.auth.signInWithPassword({email,password});
if(auth.error || !auth.data.user)throw auth.error || Error("Session propriétaire absente.");
const ownerId=auth.data.user.id;
const orgResult=await admin.from("organization_members").select("organization_id")
  .eq("user_id",ownerId).eq("status","active").limit(1).single();
if(orgResult.error)throw orgResult.error;
const org=orgResult.data.organization_id;
const suffix=randomUUID().slice(0,8);
const check=(v,msg)=>{if(!v)throw Error(msg);};
const ok=(r,label)=>{if(r.error)throw Error(label+": "+r.error.message);return r.data;};
const denied=(r,label)=>{if(!r.error && Array.isArray(r.data) && r.data.length===0)return;
  check(!!r.error,label+": accès non autorisé accepté");};

async function employee(){
  const address=`mgmail-internet-${randomUUID().slice(0,8)}@magnisa.test`;
  const pass=`MG-${randomBytes(16).toString("hex")}!e8`;
  const created=await admin.auth.admin.createUser({email:address,password:pass,email_confirm:true});
  if(created.error || !created.data.user)throw created.error || Error("Création de compte test échouée.");
  const id=created.data.user.id;
  ok(await admin.from("organization_members").insert({
    organization_id:org,user_id:id,role:"employee",status:"active",
  }),"Inscription du membre");
  const session=client(key);
  const signin=await session.auth.signInWithPassword({email:address,password:pass});
  if(signin.error)throw signin.error;
  return {id,session};
}
const a=await employee(),b=await employee();
// Les autres recettes MGMail peuvent déjà avoir initialisé cet espace.
const namespaceResult=await owner.from("mgmail_internal_namespaces")
  .select("slug").eq("organization_id",org).maybeSingle();
if(namespaceResult.error)throw namespaceResult.error;
if(!namespaceResult.data) {
  ok(await owner.from("mgmail_internal_namespaces").insert({
    organization_id:org,slug:`mgmail-net-ci-${suffix}`,
  }),"Espace interne");
}

const mailbox=ok(await owner.from("mgmail_internal_mailboxes").insert({
  organization_id:org,local_part:`finance-${suffix}`,owner_user_id:a.id,
  can_read:true,can_send:true,
}).select("id").single(),"Boîte finance").id;

const identityEmail=`finance-${suffix}@example.org`;
const identity=ok(await admin.from("mgmail_external_identities").insert({
  organization_id:org,mailbox_id:mailbox,email_address:identityEmail,
  provider:"resend",status:"active",receive_enabled:true,
}).select("id").single(),"Adresse de test isolée").id;

// Ordinary users may not turn an arbitrary third-party address into a
// verified public sender. No request is sent to example.org.
denied(await a.session.from("mgmail_external_identities").insert({
  organization_id:org,mailbox_id:mailbox,
  email_address:`fake-${suffix}@other-example.org`,
  status:"active",
}).select("id"),"Usurpation d'un domaine externe");

const can=(session,action)=>session.rpc("mgmail_can_external_access",{
  p_org:org,p_mailbox:mailbox,p_action:action,
});
check(ok(await can(a.session,"send"),"Autorisation externe initiale")===false,
  "Un salarié ne doit jamais obtenir l'envoi Internet par défaut.");
ok(await owner.from("mgmail_internal_mailboxes")
  .update({can_external_send:true,can_external_read:true})
  .eq("id",mailbox).eq("organization_id",org),"Droits Internet attribués");
check(ok(await can(a.session,"send"),"Envoi autorisé")===true,
  "Le propriétaire habilité doit pouvoir envoyer.");
check(ok(await can(a.session,"read"),"Lecture autorisée")===true,
  "Le propriétaire habilité doit pouvoir lire.");
check(ok(await can(b.session,"send"),"Interdiction collègue")===false,
  "Un autre salarié ne peut pas usurper la boîte.");

const incoming=ok(await admin.from("mgmail_external_messages").insert({
  organization_id:org,identity_id:identity,direction:"incoming",status:"received",
  from_email:"client@gmail.com",to_emails:[identityEmail],
  subject:"Réponse à votre facture",body_text:"Message d'essai isolé.",
  provider_email_id:`test-${suffix}`,
}).select("id").single(),"Message reçu simulé dans la base de test").id;
check(ok(await a.session.from("mgmail_external_messages")
  .select("id").eq("id",incoming),"Réception habilitée").length===1,
  "Le destinataire habilité ne voit pas le message.");
check(ok(await b.session.from("mgmail_external_messages")
  .select("id").eq("id",incoming),"Confidentialité collègue").length===0,
  "Un autre collaborateur lit une boîte non autorisée.");
check(ok(await owner.from("mgmail_external_messages")
  .select("id").eq("id",incoming),"Confidentialité administrateur").length===0,
  "L'administrateur ne doit pas lire automatiquement les correspondances privées.");
const notices=ok(await a.session.from("notifications").select("id")
  .eq("organization_id",org).eq("entity_id",incoming),
  "Notification e-mail Internet");
check(notices.length===1,"Le destinataire doit recevoir une notification interne.");

denied(await a.session.from("mgmail_external_messages").insert({
  organization_id:org,identity_id:identity,direction:"outgoing",status:"delivered",
  from_email:identityEmail,to_emails:["victime@example.org"],
  subject:"Fausse livraison",body_text:"Faux état fournisseur",
}).select("id"),"Usurpation de statut de livraison");
const duplicate=await admin.from("mgmail_external_messages").insert({
  organization_id:org,identity_id:identity,direction:"incoming",status:"received",
  from_email:"client@gmail.com",to_emails:[identityEmail],
  subject:"Réponse à votre facture",provider_email_id:`test-${suffix}`,
});
check(duplicate.error?.code==="23505","La base doit rejeter un webhook répété.");

ok(await owner.from("mgmail_internal_mailbox_grants").insert({
  organization_id:org,mailbox_id:mailbox,user_id:b.id,
  can_read:true,can_send:false,can_external_read:true,can_external_send:false,
  is_active:true,
}),"Délégation de lecture Internet");
check(ok(await can(b.session,"read"),"Lecture déléguée")===true,
  "Un délégué doit pouvoir lire les courriers externes.");
check(ok(await can(b.session,"send"),"Interdiction d'envoi délégué")===false,
  "La lecture seule n'autorise pas l'envoi externe.");
ok(await owner.from("mgmail_internal_mailbox_grants")
  .update({is_active:false}).eq("organization_id",org)
  .eq("mailbox_id",mailbox).eq("user_id",b.id),"Révocation déléguée");
check(ok(await can(b.session,"read"),"Revocation immédiatement effective")===false,
  "L'accès externe doit être retiré dès la révocation.");

ok(await owner.from("mgmail_internal_mailboxes")
  .update({can_external_send:false,can_external_read:false})
  .eq("organization_id",org).eq("id",mailbox),"Révocation propriétaire");
check(ok(await can(a.session,"send"),"Envoi suspendu")===false,
  "Le droit d'envoi externe doit disparaître immédiatement.");
check(ok(await a.session.from("mgmail_external_messages")
  .select("id").eq("id",incoming),"Courrier protégé après révocation").length===0,
  "Un message externe ne doit plus être visible après retrait du droit.");
process.stdout.write("PASS MGMail externe : identités, droits, confidentialité, notification, idempotence et révocation.\n");
