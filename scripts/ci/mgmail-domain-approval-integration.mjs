import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service=process.env.SUPABASE_SERVICE_ROLE_KEY;
const email=process.env.TEST_EMAIL,password=process.env.TEST_PASSWORD;
if(!url||!anon||!service||!email||!password)
  throw Error("Environnement MGMail isolé non configuré.");
const create=(key)=>createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}});
const admin=create(service),owner=create(anon);
const signed=await owner.auth.signInWithPassword({email,password});
if(signed.error||!signed.data.user)throw signed.error||Error("Propriétaire introuvable.");
const uid=signed.data.user.id;
const orgResult=await admin.from("organization_members").select("organization_id")
  .eq("user_id",uid).eq("status","active").limit(1).single();
if(orgResult.error)throw orgResult.error;
const org=orgResult.data.organization_id;
const suffix=randomUUID().slice(0,8);
const domain=`mgmail-${suffix}.example.net`;
const address=`finance@${domain}`;
const check=(value,msg)=>{if(!value)throw Error(msg);};
const ok=(result,label)=>{if(result.error||!result.data)
  throw Error(label+": "+(result.error?.message||"absent"));return result.data;};
const forbidden=(result,label)=>{if(result.error)return;
  check(Array.isArray(result.data)&&result.data.length===0,label+": action autorisée à tort");};

const existing=await owner.from("mgmail_internal_namespaces")
  .select("slug").eq("organization_id",org).maybeSingle();
if(existing.error)throw existing.error;
if(!existing.data){
  ok(await owner.from("mgmail_internal_namespaces").insert({
    organization_id:org,slug:`domains-ci-${suffix}`,
  }).select("organization_id").single(),"Namespace MGMail");
}
const box=ok(await owner.from("mgmail_internal_mailboxes").insert({
  organization_id:org,local_part:`mail-${suffix}`,owner_user_id:uid,
}).select("id").single(),"Boîte interne").id;

const domainRequest=ok(await owner.from("mgmail_domain_requests").insert({
  organization_id:org,domain_name:domain,requested_by:uid,
}).select("id,status").single(),"Demande domaine");
check(domainRequest.status==="pending","Le domaine doit rester en attente.");
const addressRequest=ok(await owner.from("mgmail_public_address_requests").insert({
  organization_id:org,mailbox_id:box,email_address:address,requested_by:uid,
}).select("id,status").single(),"Demande adresse");
check(addressRequest.status==="pending","L'adresse doit rester en attente.");

for(const table of ["mgmail_domain_requests","mgmail_public_address_requests"]){
  const row=table==="mgmail_domain_requests"?domainRequest:addressRequest;
  forbidden(await owner.from(table).update({status:"approved"}).eq("id",row.id)
    .select("id"),"L'entreprise ne peut approuver sa propre demande");
}

forbidden(await owner.from("mgmail_verified_domains").insert({
  organization_id:org,domain_name:domain,provider_domain_id:`ci-${suffix}`,
  sending_verified:true,receiving_verified:true,ownership_approved:true,
  operator_reference:"malicious",provider_checked_at:new Date().toISOString(),
}).select("id"),"Un utilisateur ne peut créer une preuve fournisseur.");

const noDomain=await admin.from("mgmail_external_identities").insert({
  organization_id:org,mailbox_id:box,email_address:address,
  status:"active",receive_enabled:true,
});
check(!!noDomain.error,"L'activation sans preuve doit être refusée même au service_role.");

const proof=ok(await admin.from("mgmail_verified_domains").insert({
  organization_id:org,domain_name:domain,
  provider:"resend",provider_domain_id:`ci-${suffix}`,
  sending_verified:false,receiving_verified:false,
  ownership_approved:true,operator_reference:"CI isolated only",
  provider_checked_at:new Date().toISOString(),
}).select("id").single(),"Preuve fournisseur fictive").id;
const notVerified=await admin.from("mgmail_external_identities").insert({
  organization_id:org,mailbox_id:box,email_address:address,
  verified_domain_id:proof,status:"active",receive_enabled:false,
});
check(!!notVerified.error,"L'activation est interdite sans DNS d'envoi validé.");

ok(await admin.from("mgmail_verified_domains").update({sending_verified:true})
  .eq("id",proof).select("id").single(),"Envoi validé en CI");
const noMx=await admin.from("mgmail_external_identities").insert({
  organization_id:org,mailbox_id:box,email_address:address,
  verified_domain_id:proof,status:"active",receive_enabled:true,
});
check(!!noMx.error,"La réception est interdite sans MX vérifié.");

const wrongAddress=await admin.from("mgmail_external_identities").insert({
  organization_id:org,mailbox_id:box,email_address:`finance@other-${suffix}.example.net`,
  verified_domain_id:proof,status:"active",receive_enabled:false,
});
check(!!wrongAddress.error,"Une preuve ne doit pas servir à un autre domaine.");

ok(await admin.from("mgmail_verified_domains").update({receiving_verified:true})
  .eq("id",proof).select("id").single(),"Réception validée en CI");
const activated=ok(await admin.from("mgmail_external_identities").insert({
  organization_id:org,mailbox_id:box,email_address:address,
  verified_domain_id:proof,status:"active",receive_enabled:true,
}).select("id,status,receive_enabled").single(),"Identité autorisée avec preuve fictive");
check(activated.status==="active"&&activated.receive_enabled,
  "L'identité doit être activable uniquement après les preuves.");

ok(await admin.from("mgmail_verified_domains").update({sending_verified:false})
  .eq("id",proof).select("id").single(),"Retrait de validité DNS");
const suspended=ok(await admin.from("mgmail_external_identities")
  .select("status,receive_enabled").eq("id",activated.id).single(),
  "Suspension automatique");
check(suspended.status==="suspended"&&!suspended.receive_enabled,
  "La perte de preuve doit suspendre la boîte, sans envoi possible.");

process.stdout.write(
 "PASS MGMail: demandes, RLS, approbation privilégiée, preuves DNS, MX et suspension automatique.\n"
);
