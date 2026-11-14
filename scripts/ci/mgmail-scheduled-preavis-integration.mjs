import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { ensureMGMailCIVerifiedDomain } from "./mgmail-domain-fixture.mjs";

const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service=process.env.SUPABASE_SERVICE_ROLE_KEY;
const email=process.env.TEST_EMAIL, password=process.env.TEST_PASSWORD;
if (!url || !anon || !service || !email || !password) {
  throw new Error("Test MGMail : environnement local non configuré.");
}
const client=(key)=>createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}});
const admin=client(service), owner=client(anon);
const session=await owner.auth.signInWithPassword({email,password});
if(session.error||!session.data.user)throw session.error||Error("Session de test absente.");
const ownerId=session.data.user.id;
const orgResponse=await admin.from("organization_members").select("organization_id")
  .eq("user_id",ownerId).eq("status","active").limit(1).single();
if(orgResponse.error)throw orgResponse.error;
const org=orgResponse.data.organization_id;
const ok=(r,label)=>{if(r.error)throw Error(label+": "+r.error.message);return r.data;};
const check=(v,label)=>{if(!v)throw Error(label);};
const denied=(r,label)=>{if(r.error)return;
  check(Array.isArray(r.data)&&r.data.length===0,label+" : action refusée attendue");};
const suffix=randomUUID().slice(0,8);

const namespace=await owner.from("mgmail_internal_namespaces")
  .select("slug").eq("organization_id",org).maybeSingle();
if(namespace.error)throw namespace.error;
if(!namespace.data){
  ok(await owner.from("mgmail_internal_namespaces").insert({
    organization_id:org,slug:`mgmail-scheduler-${suffix}`,
  }),"Création de l'espace interne");
}
const mailbox=ok(await owner.from("mgmail_internal_mailboxes").insert({
  organization_id:org,local_part:`scheduler-${suffix}`,owner_user_id:ownerId,
}).select("id").single(),"Boîte de planification").id;
ok(await owner.from("mgmail_internal_mailboxes")
  .update({can_external_send:true,can_external_read:true})
  .eq("id",mailbox).eq("organization_id",org),"Autorisation d'envoi du propriétaire");

const verifiedDomainId = await ensureMGMailCIVerifiedDomain(admin, org);
const fakeEmail=`scheduler-${suffix}@example.org`;
const identity=ok(await admin.from("mgmail_external_identities").insert({
  organization_id:org,mailbox_id:mailbox,email_address:fakeEmail,
  verified_domain_id:verifiedDomainId,
  status:"active",provider:"resend",receive_enabled:false,
}).select("id").single(),"Identité simulée sans envoi Internet").id;

const requestKey=randomUUID();
const scheduledAt="2026-12-14T06:00:00.000Z";
const inserted=ok(await admin.from("mgmail_external_messages").insert({
  organization_id:org,identity_id:identity,
  direction:"outgoing",source_kind:"scheduled",status:"queued",
  from_email:fakeEmail,to_emails:["client@proton.me"],
  subject:"Rappel de rendez-vous",body_text:"Bonjour, voici votre rappel.",
  created_by:ownerId,scheduled_at:scheduledAt,request_key:requestKey,
}).select("id,status,source_kind,scheduled_at").single(),"Message programmé").id;

check(ok(await owner.from("mgmail_external_messages").select("id")
  .eq("id",inserted),"Consultation programme").length===1,
  "L'auteur habilité doit pouvoir consulter sa programmation.");

const repeated=await admin.from("mgmail_external_messages").insert({
  organization_id:org,identity_id:identity,direction:"outgoing",
  source_kind:"scheduled",status:"queued",scheduled_at:scheduledAt,
  from_email:fakeEmail,to_emails:["client@proton.me"],
  subject:"Rappel de rendez-vous",body_text:"Bonjour",
  request_key:requestKey,created_by:ownerId,
});
check(repeated.error?.code==="23505",
  "Une même clé de programmation doit interdire un double envoi.");

denied(await owner.from("mgmail_external_messages").insert({
  organization_id:org,identity_id:identity,direction:"outgoing",
  source_kind:"scheduled",status:"delivered",scheduled_at:scheduledAt,
  from_email:fakeEmail,to_emails:["client@proton.me"],
  subject:"Fausse preuve",body_text:"Le navigateur ne doit pas définir l'état.",
}).select("id"),"Fabrication d'un statut livré par un utilisateur");

denied(await owner.from("mgmail_external_messages")
  .update({status:"delivered"}).eq("id",inserted).select("id"),
  "Modification de statut depuis le navigateur");

const malformed=await admin.from("mgmail_external_messages").insert({
  organization_id:org,identity_id:identity,direction:"outgoing",
  source_kind:"billing_preavis",status:"queued",scheduled_at:scheduledAt,
  from_email:fakeEmail,to_emails:["client@proton.me"],
  subject:"Préavis incomplet",body_text:"Pas de contrat",
});
check(!!malformed.error,"Le préavis doit posséder un contrat, sa date et son délai.");

const noDate=await admin.from("mgmail_external_messages").insert({
  organization_id:org,identity_id:identity,direction:"outgoing",
  source_kind:"scheduled",status:"queued",
  from_email:fakeEmail,to_emails:["client@proton.me"],
  subject:"Sans programmation",body_text:"Pas de date d'envoi",
});
check(!!noDate.error,"Un message programmé doit avoir une échéance.");

ok(await admin.from("mgmail_external_messages")
  .update({status:"cancelled",last_error:"Annulé par l'expéditeur"})
  .eq("id",inserted).eq("status","queued"),"Annulation en base");
const cancelled=ok(await owner.from("mgmail_external_messages")
  .select("status").eq("id",inserted).single(),"État annulé");
check(cancelled.status==="cancelled","Une annulation ne doit pas apparaître comme un échec.");

const duplicateCancelled=await admin.from("mgmail_external_messages").insert({
  organization_id:org,identity_id:identity,direction:"outgoing",
  source_kind:"scheduled",status:"queued",scheduled_at:scheduledAt,
  from_email:fakeEmail,to_emails:["client@proton.me"],
  subject:"Doublon annulé",body_text:"Même demande",
  request_key:requestKey,created_by:ownerId,
});
check(duplicateCancelled.error?.code==="23505",
  "Une demande annulée ne peut pas être relancée avec le même identifiant.");

process.stdout.write("PASS MGMail programmation : RLS, états, annulation, anti-doublon et conformité des préavis.\n");
