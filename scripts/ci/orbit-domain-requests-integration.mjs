import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!anon||!service)throw Error("Domain test requires the disposable Supabase CI stack.");
const client=key=>createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
const admin=client(service);
const token=randomUUID().slice(0,10);
async function fixture(role){
  const email=`orbit-domain-${role}-${token}@magnisa.test`;
  const password=`OD-${randomBytes(16).toString("hex")}!a9`;
  const user=await admin.auth.admin.createUser({email,password,email_confirm:true});
  if(user.error||!user.data.user)throw user.error||Error("Account creation failed");
  const account=client(anon);
  const login=await account.auth.signInWithPassword({email,password});
  if(login.error)throw login.error;
  return {id:user.data.user.id,account};
}
const owner=await fixture("owner");
const employee=await fixture("employee");
const outsider=await fixture("outsider");
const orgResult=await owner.account.rpc("create_organization",{
  p_name:`Orbit Domains CI ${token}`,p_currency:"MGA",
});
if(orgResult.error||typeof orgResult.data!=="string")throw orgResult.error||Error("Company creation failed");
const org=orgResult.data;
const anotherOrg=await outsider.account.rpc("create_organization",{
  p_name:`Orbit Foreign CI ${token}`,p_currency:"MGA",
});
if(anotherOrg.error||typeof anotherOrg.data!=="string")throw anotherOrg.error||Error("Other company creation failed");
const added=await admin.from("organization_members").insert({
  organization_id:org,user_id:employee.id,role:"employee",status:"active",
});
if(added.error)throw added.error;
const ok=(x,description)=>{if(x.error||!x.data)throw Error(description+": "+x.error?.message);return x.data;};
const denied=(x,description)=>{
  if(x.error)return;
  if(Array.isArray(x.data)&&x.data.length===0)return;
  throw Error(description+": unauthorized data/action allowed");
};

const domain=`ci-${token}.example.org`;
const namespace=ok(await owner.account.from("mgmail_internal_namespaces").insert({
  organization_id:org,slug:`ci-${token}`,
}).select("organization_id").single(),"namespace");
const mailbox=ok(await owner.account.from("mgmail_internal_mailboxes").insert({
  organization_id:namespace.organization_id,local_part:"finance",owner_user_id:owner.id,
}).select("id").single(),"internal mailbox");

const request=ok(await owner.account.from("mgmail_domain_requests").insert({
  organization_id:org,domain_name:domain,requested_by:owner.id,
}).select("id,status,domain_name,verification_token").single(),"domain request");
if(request.status!=="pending"||request.domain_name!==domain)throw Error("Domain request must remain pending");
if(!/^[0-9a-f]{64}$/.test(request.verification_token))throw Error("DNS challenge must have 244 random bits");
denied(await employee.account.from("mgmail_domain_requests")
  .select("verification_token").eq("id",request.id),
  "Employee must not read another person's DNS ownership challenge");
denied(await owner.account.from("mgmail_domain_requests").insert({
  organization_id:org,domain_name:`forged-${token}.example.org`,
  requested_by:owner.id,verification_token:"b".repeat(64),
}).select("id"),"Browser may not choose its own DNS proof token");
const address=ok(await owner.account.from("mgmail_public_address_requests").insert({
  organization_id:org,mailbox_id:mailbox.id,domain_request_id:request.id,
  domain_name:domain,local_part:"direction",requested_by:owner.id,
}).select("email_address,status").single(),"professional address request");
if(address.status!=="pending"||address.email_address!==`direction@${domain}`)
  throw Error("No real mailbox must be provisioned by the request");

denied(await employee.account.from("mgmail_domain_requests").select("id").eq("organization_id",org),
  "Employee must not see admin domain registry");
denied(await employee.account.from("mgmail_domain_requests").insert({
  organization_id:org,domain_name:`bad-${token}.example.net`,requested_by:employee.id,
}).select("id"),"Employee cannot request a domain");
denied(await outsider.account.from("mgmail_public_address_requests").select("id").eq("organization_id",org),
  "Foreign company cannot see pending addresses");
denied(await outsider.account.from("mgmail_domain_requests").insert({
  organization_id:org,domain_name:`foreign-${token}.example.net`,requested_by:outsider.id,
}).select("id"),"Foreign company cannot claim someone else's organization");
denied(await owner.account.from("mgmail_domain_requests").update({
  status:"verified",verified_at:new Date().toISOString(),proof_reference:"client fraud",
}).eq("id",request.id).select("id"),"Admin cannot self-verify a public domain");
denied(await owner.account.from("mgmail_public_address_requests")
  .update({status:"approved"}).eq("organization_id",org).select("id"),
  "Admin cannot self-activate a public address");
denied(await owner.account.from("mgmail_public_address_requests").insert({
  organization_id:org,mailbox_id:mailbox.id,domain_request_id:request.id,
  domain_name:`other-${token}.example.net`,local_part:"support",requested_by:owner.id,
}).select("id"),"Foreign domain name cannot be attached to a request");
const stillPending=ok(await owner.account.from("mgmail_domain_requests")
  .select("status,verified_at").eq("id",request.id).single(),"domain state");
if(stillPending.status!=="pending"||stillPending.verified_at!==null)
  throw Error("Domain unexpectedly verified");
// Service-role queries intentionally bypass RLS; they do not test tenant privacy.
// Verify the two fixtures are distinct, and rely on the outsider's authenticated
// RLS probes above to enforce the real user-facing isolation boundary.
if(org===anotherOrg)throw Error("The isolated companies unexpectedly share an identifier.");
console.log("PASS Orbit Inbox: custom-domain requests, generated addresses, administrator rights, tenant isolation, no self-activation.");
