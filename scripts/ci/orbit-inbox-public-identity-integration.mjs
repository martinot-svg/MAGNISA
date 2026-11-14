import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
const key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!key||!service)throw Error("Run only against disposable local Supabase.");
const cli=k=>createClient(url,k,{auth:{persistSession:false,autoRefreshToken:false}});
const admin=cli(service),stamp=randomUUID().slice(0,10);
const ok=(result,desc)=>{if(result.error||!result.data)throw Error(desc+": "+result.error?.message);return result.data;};
const deny=(result,desc)=>{
  if(result.error)return;
  if(Array.isArray(result.data)&&result.data.length===0)return;
  throw Error(desc+": unexpectedly authorized");
};
async function user(role){
  const email=`orbit-public-${role}-${stamp}@magnisa.test`;
  const password=`INBOX-${randomBytes(14).toString("hex")}!a9`;
  const created=ok(await admin.auth.admin.createUser({email,password,email_confirm:true}),"user");
  const account=cli(key);
  const login=await account.auth.signInWithPassword({email,password});
  if(login.error)throw login.error;
  return {id:created.user.id,account};
}
const owner=await user("owner"),employee=await user("employee"),outsider=await user("outsider");
const org=ok(await owner.account.rpc("create_organization",{
  p_name:`Orbit Internet CI ${stamp}`,p_currency:"MGA",
}),"organization");
const foreignOrg=ok(await outsider.account.rpc("create_organization",{
  p_name:`Orbit Foreign CI ${stamp}`,p_currency:"MGA",
}),"other organization");
const m=await admin.from("organization_members").insert({
  organization_id:org,user_id:employee.id,role:"employee",status:"active",
});
if(m.error)throw m.error;
const namespace=ok(await owner.account.from("mgmail_internal_namespaces").insert({
  organization_id:org,slug:`inbox-${stamp}`,
}).select("organization_id").single(),"namespace");
const mailbox=ok(await owner.account.from("mgmail_internal_mailboxes").insert({
  organization_id:namespace.organization_id,local_part:"finance",owner_user_id:owner.id,
}).select("id").single(),"mailbox");
const internal=await admin.from("mgmail_internal_mailbox_grants").insert({
  organization_id:org,mailbox_id:mailbox.id,user_id:employee.id,
  can_read:true,can_send:true,is_active:true,
});
if(internal.error)throw internal.error;
const domain=`ci-${stamp}.example.org`;
const d=ok(await owner.account.from("mgmail_domain_requests").insert({
  organization_id:org,domain_name:domain,requested_by:owner.id,
}).select("id,status").single(),"domain");
const a=ok(await owner.account.from("mgmail_public_address_requests").insert({
  organization_id:org,domain_request_id:d.id,domain_name:domain,
  mailbox_id:mailbox.id,local_part:"finance",requested_by:owner.id,
}).select("id,status").single(),"requested address");
const prototype={
  organization_id:org,domain_request_id:d.id,address_request_id:a.id,
  mailbox_id:mailbox.id,domain_name:domain,local_part:"finance",
  provider:"resend",provider_domain_ref:`provider-${stamp}`,
  provider_verified_at:new Date().toISOString(),status:"active",receive_enabled:true,
};
// Even service role may not activate a sender before domain and address approval.
deny(await admin.from("orbit_public_identities").insert(prototype).select("id"),
  "Unverified public identity activation");
const proof=await admin.from("mgmail_domain_requests").update({
  status:"verified",verified_at:new Date().toISOString(),proof_reference:"ci-verified-only",
}).eq("id",d.id);
if(proof.error)throw proof.error;
const approval=await admin.from("mgmail_public_address_requests")
  .update({status:"approved"}).eq("id",a.id);
if(approval.error)throw approval.error;
const identity=ok(await admin.from("orbit_public_identities").insert(prototype)
  .select("id,email_address,status").single(),"verified identity");
if(identity.email_address!==`finance@${domain}`||identity.status!=="active")
  throw Error("Generated identity should be active only after two approvals");

deny(await owner.account.from("orbit_public_identities").insert({
  ...prototype,local_part:"invented",
}).select("id"),"Admin cannot self-provision a public sender");
deny(await owner.account.from("orbit_public_identities").update({
  provider:"smtp",
}).eq("id",identity.id).select("id"),"Admin cannot bypass transport provider approval");
deny(await outsider.account.from("orbit_public_identities").select("id")
  .eq("organization_id",org),"Foreign tenant cannot view identity");

const ownGrant=await admin.from("orbit_external_mailbox_access").insert({
  organization_id:org,identity_id:identity.id,user_id:owner.id,
  can_read:true,can_send:true,is_active:true,
});
if(ownGrant.error)throw ownGrant.error;
const colleagueGrant=await admin.from("orbit_external_mailbox_access").insert({
  organization_id:org,identity_id:identity.id,user_id:employee.id,
  can_read:true,can_send:false,is_active:true,
});
if(colleagueGrant.error)throw colleagueGrant.error;
deny(await employee.account.from("orbit_external_mailbox_access").insert({
  organization_id:org,identity_id:identity.id,user_id:outsider.id,can_send:true,
}).select("identity_id"),"Employee cannot grant another user's email access");
const ownerCanSend=ok(await owner.account.rpc("orbit_can_public_mail_access",{
  p_org:org,p_identity:identity.id,p_action:"send",
}),"owner permission");
const employeeCanRead=ok(await employee.account.rpc("orbit_can_public_mail_access",{
  p_org:org,p_identity:identity.id,p_action:"read",
}),"employee read permission");
const employeeCanSend=await employee.account.rpc("orbit_can_public_mail_access",{
  p_org:org,p_identity:identity.id,p_action:"send",
});
if(ownerCanSend!==true||employeeCanRead!==true||employeeCanSend.data!==false)
  throw Error("External permissions differ from grants");
const incoming=ok(await admin.from("orbit_external_messages").insert({
  organization_id:org,identity_id:identity.id,direction:"incoming",
  status:"received",from_email:"client@example.net",
  to_emails:[`finance@${domain}`],subject:"Bonjour",body_text:"Facture reçue",
  provider_email_id:`email-${stamp}`,
}).select("id").single(),"incoming public email");
const outgoing=ok(await admin.from("orbit_external_messages").insert({
  organization_id:org,identity_id:identity.id,direction:"outgoing",
  status:"queued",from_email:`finance@${domain}`,to_emails:["client@example.net"],
  subject:"Réponse",body_text:"Bonjour",created_by:owner.id,request_key:randomUUID(),
}).select("id,request_key").single(),"outgoing public email");
const read=await employee.account.from("orbit_external_messages")
  .select("id").eq("organization_id",org);
if(read.error||read.data.length!==2)throw Error("Granted employee cannot read shared public inbox");
deny(await outsider.account.from("orbit_external_messages").select("id").eq("organization_id",org),
  "Foreign company can read mail");
deny(await owner.account.from("orbit_external_messages").insert({
  organization_id:org,identity_id:identity.id,direction:"outgoing",status:"queued",
  subject:"Injection",from_email:`finance@${domain}`,
}).select("id"),"Browser must not write message ledger");
deny(await admin.from("orbit_external_messages").insert({
  organization_id:org,identity_id:identity.id,direction:"outgoing",status:"queued",
  subject:"Duplicate",from_email:`finance@${domain}`,
  request_key:outgoing.request_key,
}).select("id"),"Duplicate provider send request key");
const revoke=await admin.from("orbit_external_mailbox_access").update({
  is_active:false,
}).eq("organization_id",org).eq("identity_id",identity.id).eq("user_id",employee.id);
if(revoke.error)throw revoke.error;
const readAfter=await employee.account.from("orbit_external_messages").select("id")
  .eq("organization_id",org);
if(readAfter.error||readAfter.data.length!==0)throw Error("Revoked employee still sees mail");
const removeDomain=await admin.from("mgmail_domain_requests").update({
  status:"rejected",verified_at:null,
}).eq("id",d.id);
if(removeDomain.error)throw removeDomain.error;
const revoked=ok(await admin.from("orbit_public_identities")
  .select("status,receive_enabled").eq("id",identity.id).single(),"revoked identity");
if(revoked.status!=="suspended"||revoked.receive_enabled!==false)
  throw Error("Domain revocation did not suspend public identity");
const stillSent=await admin.from("orbit_external_messages").select("id")
  .eq("id",outgoing.id).single();
if(stillSent.error||!stillSent.data)throw Error("Suspension must preserve historical sent mail");
if(org===foreignOrg||incoming.id===outgoing.id)throw Error("Test fixtures not isolated");
console.log("PASS Orbit public identities: verified domain+address, RLS, read/send separation, revocation, history, no browser writes.");
