import {randomBytes,randomUUID} from "node:crypto";
import {createClient} from "@supabase/supabase-js";

const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!anon||!service)throw Error("MAGNIBOX free-domain test requires the disposable Supabase CI stack.");
const client=key=>createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
const admin=client(service);
const token=randomUUID().replace(/-/g,"").slice(0,12);
async function fixture(role){
  const email=`magnibox-free-domain-${role}-${token}@magnisa.test`;
  const password=`MFD-${randomBytes(16).toString("hex")}!a9`;
  const created=await admin.auth.admin.createUser({email,password,email_confirm:true});
  if(created.error||!created.data.user)throw created.error||Error("Could not create isolated test user");
  const account=client(anon);
  const login=await account.auth.signInWithPassword({email,password});
  if(login.error)throw login.error;
  return {id:created.data.user.id,account};
}
const owner=await fixture("owner");
const employee=await fixture("employee");
const outsider=await fixture("outsider");
const unwrap=(result,label)=>{
  if(result.error)throw Error(label+": "+result.error.message);
  return result.data;
};
const org=unwrap(await owner.account.rpc("create_organization",{
  p_name:`MAGNIBOX free domain ${token}`,p_currency:"MGA",
}),"create organization");
const otherOrg=unwrap(await outsider.account.rpc("create_organization",{
  p_name:`MAGNIBOX foreign domain ${token}`,p_currency:"MGA",
}),"create foreign organization");
unwrap(await admin.from("organization_members").insert({
  organization_id:org,user_id:employee.id,role:"employee",status:"active",
}),"add employee");

const rootDomain=`platform-${token}.example.test`;
const catalog=unwrap(await admin.from("magnibox_platform_domain_catalog").insert({
  root_domain:rootDomain,display_name:"MAGNISA Test Domain",category:"test",
  ownership_status:"verified",ownership_verified_at:new Date().toISOString(),
  ownership_evidence_ref:"ci-fixture-only",
  mail_status:"ready",mx_verified:true,spf_verified:true,dkim_verified:true,dmarc_verified:true,
  is_free:true,is_active:true,
}).select("id").single(),"seed controlled platform domain");
const hidden=unwrap(await admin.from("magnibox_platform_domain_catalog").insert({
  root_domain:`pending-${token}.example.test`,display_name:"Pending Test Domain",
  ownership_status:"pending",mail_status:"pending",is_free:true,is_active:false,
}).select("id").single(),"seed inactive platform domain");

const visible=unwrap(await owner.account.from("magnibox_platform_domain_catalog")
  .select("id,root_domain").order("root_domain"),"read available catalogue");
if(visible.length!==1||visible[0].id!==catalog.id||visible[0].root_domain!==rootDomain)
  throw Error("Only active, owned and mail-ready platform domains may be selectable");
const hiddenProbe=await owner.account.from("magnibox_platform_domain_catalog")
  .select("id").eq("id",hidden.id);
if(hiddenProbe.error||hiddenProbe.data.length!==0)
  throw Error("Unverified platform domain leaked into the selectable catalogue");

const denied=async(result,label)=>{
  if(result.error)return;
  if(Array.isArray(result.data)&&result.data.length===0)return;
  throw Error(label+": unauthorized operation succeeded");
};
await denied(owner.account.from("magnibox_platform_domain_catalog").insert({
  root_domain:`forged-${token}.example.test`,display_name:"Forged",
}).select("id"),"browser cannot add a platform domain");
await denied(owner.account.from("magnibox_platform_domain_allocations").insert({
  organization_id:org,catalog_domain_id:catalog.id,root_domain:rootDomain,
  tenant_label:"forged",requested_by:owner.id,
}).select("id"),"browser cannot write a domain allocation");

const reserve=async(account,organizationId,label)=>
  unwrap(await account.rpc("magnibox_reserve_free_domain",{
    p_organization_id:organizationId,p_catalog_domain_id:catalog.id,p_tenant_label:label,
  }),"reserve free domain");
const firstRows=await reserve(owner.account,org,`company-${token}`);
const firstRow=Array.isArray(firstRows)?firstRows[0]:firstRows;
if(!firstRow||firstRow.assigned_domain!==`company-${token}.${rootDomain}`||firstRow.allocation_status!=="reserved")
  throw Error("Free domain reservation did not create the expected reserved subdomain");
const repeatRows=await reserve(owner.account,org,`company-${token}`);
const repeat=Array.isArray(repeatRows)?repeatRows[0]:repeatRows;
if(repeat?.allocation_id!==firstRow.allocation_id)
  throw Error("Repeated reservation must be idempotent");
await denied(employee.account.rpc("magnibox_reserve_free_domain",{
  p_organization_id:org,p_catalog_domain_id:catalog.id,p_tenant_label:`employee-${token}`,
}),"non-admin member cannot reserve a company domain");

const foreignRows=await reserve(outsider.account,otherOrg,`other-${token}`);
const foreign=Array.isArray(foreignRows)?foreignRows[0]:foreignRows;
if(foreign?.assigned_domain!==`other-${token}.${rootDomain}`)
  throw Error("A second company could not receive its own unique subdomain");
const crossTenant=unwrap(await outsider.account.from("magnibox_platform_domain_allocations")
  .select("id").eq("organization_id",org),"foreign allocation isolation");
if(crossTenant.length!==0)throw Error("Foreign company can read another company's allocation");

await denied(owner.account.rpc("magnibox_reserve_free_domain",{
  p_organization_id:org,p_catalog_domain_id:catalog.id,p_tenant_label:`another-${token}`,
}),"one current domain allocation per organization");
const stored=unwrap(await owner.account.from("magnibox_platform_domain_allocations")
  .select("assigned_domain,status").eq("organization_id",org).single(),"read own reservation");
if(stored.assigned_domain!==firstRow.assigned_domain||stored.status!=="reserved")
  throw Error("Reservation was not persisted in the owning company");
console.log("PASS MAGNIBOX free platform domains: verified catalogue, free tenant allocation, idempotency, admin-only reservation and tenant isolation.");
