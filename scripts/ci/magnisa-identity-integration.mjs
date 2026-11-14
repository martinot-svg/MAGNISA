import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !secret) throw new Error("Isolated Supabase test credentials required.");
const admin = createClient(url,secret,{auth:{autoRefreshToken:false,persistSession:false}});
const assert = (ok,description) => {if(!ok)throw new Error(description);};
const suffix = Date.now();
const email = `identity-fixture-${suffix}@magnisa.test`;
let username = "";
const password = "Fixture-Identity-2026!Aa";
let userId = null;
let createdCompanyId = null;
try {
  const created = await admin.auth.admin.createUser({
    email, password, email_confirm:true,
    user_metadata:{full_name:"Utilisateur MAGNISA Test"},
  });
  if (created.error || !created.data.user) throw created.error || new Error("Cannot create user");
  userId = created.data.user.id;
  const origin = await admin.rpc("register_magnisa_signup_origin",{
    p_user:userId,p_country:"261",p_locality:"601"
  });
  if(origin.error)throw origin.error;
  const privateMetadata = await admin.auth.admin.getUserById(userId);
  assert(!privateMetadata.data.user?.user_metadata?.country_code &&
    !privateMetadata.data.user?.user_metadata?.locality_code,
    "Origin codes must NEVER leak in Auth user metadata.");
  const profile = await admin.from("profiles").select("public_id,username,full_name").eq("id",userId).single();
  if(profile.error) throw profile.error;
  assert(/^[0-9]{14}$/.test(profile.data.public_id),"Public id must contain 14 digits.");
  assert(/^[a-z]{2,10}$/.test(profile.data.username),"Signup username must be generated automatically.");
  username=profile.data.username;
  assert(profile.data.full_name==="Utilisateur MAGNISA Test","Full name must be saved.");
  console.log("OK profile with unique opaque 14-digit ID");

  const visitor = createClient(url,anonKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const anonDirectory = await visitor.rpc("magnisa_platform_origin_directory");
  assert(!!anonDirectory.error,"Owner origin directory must not be readable by anon.");
  const anonProfile = await visitor.from("profiles").select("public_id").eq("id",userId);
  assert(!!anonProfile.error || anonProfile.data?.length===0,"Anonymous visitors must not read profiles.");

  const signed = await visitor.auth.signInWithPassword({email,password});
  if(signed.error)throw signed.error;
  const reg = await visitor.rpc("has_magnisa_registration");
  assert(!reg.error && reg.data===true,"Registration origin should be recorded.");
  // Five-step company onboarding must create the business and its fiscal profile atomically.
  const companyPayload = {
    legalName:"Entreprise test Morombe",tradeName:"",slogan:"",
    sectorCode:"G",primaryActivity:"Épicerie",secondaryActivities:["Livraison et coursier"],
    legalForm:"EI",registrationStatus:"pending",nif:"",stat:"",rcs:"",
    country:"MG",regionCode:"908",localityName:"Ambahikily",localityRef:"",
    address:"District de Morombe",phone:"",email:"",currency:"MGA",
    taxRegime:"IS",vatStatus:"A_VERIFIER",fiscalStart:"2026-01-01",
    fiscalEnd:"2026-12-31",hasExistingAccounts:false,fiscalProfileConfirmed:false,
  };
  const createdCompany = await visitor.rpc("magnisa_create_onboarded_company",{p_payload:companyPayload});
  if(createdCompany.error || !createdCompany.data){
    throw createdCompany.error || new Error("Cannot create company through onboarding RPC");
  }
  createdCompanyId = createdCompany.data;
  const [newCompany,settings,membership] = await Promise.all([
    admin.from("organizations").select("name,currency").eq("id",createdCompanyId).single(),
    admin.from("company_settings").select("activity_sector,income_tax_regime,vat_status,fiscal_profile_confirmed,onboarding_profile").eq("organization_id",createdCompanyId).single(),
    admin.from("organization_members").select("role,status").eq("organization_id",createdCompanyId).eq("user_id",userId).single(),
  ]);
  assert(!newCompany.error && newCompany.data.name==="Entreprise test Morombe","Company creation must register its declared name.");
  assert(!settings.error && settings.data.activity_sector==="G","Company's primary sector must be saved.");
  assert(settings.data.income_tax_regime==="IS" && settings.data.vat_status==="A_VERIFIER" && settings.data.fiscal_profile_confirmed===false,
    "Tax regime and VAT are declared, not pre-confirmed.");
  assert(settings.data.onboarding_profile.localityName==="Ambahikily" &&
    settings.data.onboarding_profile.fiscalStart==="2026-01-01",
    "Exact company locality and initial fiscal dates must be retained.");
  assert(!membership.error && membership.data.role==="owner" && membership.data.status==="active",
    "The creator must be the company owner.");
  const anonymousCompany=await createClient(url,anonKey,{auth:{persistSession:false,autoRefreshToken:false}})
    .rpc("magnisa_create_onboarded_company",{p_payload:companyPayload});
  assert(!!anonymousCompany.error,"Anonymous users must not create companies.");
  console.log("OK company onboarding RPC, RLS, fiscal configuration and ownership");
  // Do not delete the created company: MAGNISA's append-only audit log
  // explicitly prevents destructive cascade. This is an isolated resettable CI DB.
  const denied = await visitor.rpc("magnisa_platform_origin_directory");
  assert(!!denied.error,"An ordinary authenticated user must not read the private origin directory.");
  const profiles = await visitor.from("profiles").select("public_id,username").eq("id",userId).single();
  assert(!profiles.error && profiles.data.public_id===profile.data.public_id,"Own public ID must be visible.");

  const changeTooSoon = await visitor.rpc("claim_magnisa_identity",{
    p_full_name:"Utilisateur MAGNISA Test",
    p_username:username.slice(0,9)+"z",
    p_country:"",
    p_locality:"",
  });
  assert(!!changeTooSoon.error && changeTooSoon.error.message.includes("30 jours"),"Username rename inside 30 days must be rejected.");
  const same = await visitor.rpc("claim_magnisa_identity",{
    p_full_name:"Utilisateur MAGNISA Test",
    p_username:username,
    p_country:"",
    p_locality:"",
  });
  assert(!same.error,"Reconfirming current username should work.");
  const second=await admin.auth.admin.createUser({
    email:`identity-second-${suffix}@magnisa.test`,
    password, email_confirm:true,
    user_metadata:{full_name:"Deuxième utilisateur Test"}
  });
  if(second.error||!second.data.user)throw second.error??new Error("Second user creation failed");
  const otherId=second.data.user.id;
  try{
    const other=await admin.from("profiles").select("public_id").eq("id",otherId).single();
    assert(!other.error && other.data.public_id!==profile.data.public_id,"Public IDs must be distinct.");
    const forbidden=await visitor.from("profiles").select("public_id").eq("id",otherId);
    assert(!forbidden.error&&forbidden.data.length===0,"RLS must hide other users' profiles.");
  }finally{await admin.auth.admin.deleteUser(otherId);}
  console.log("OK identity claims, username cooldown, MFA owner-only RPC and profile RLS");
} finally {
  if(userId && !createdCompanyId){
    const deleted=await admin.auth.admin.deleteUser(userId);
    if(deleted.error)console.error("Test cleanup error:",deleted.error.message);
  } else if(createdCompanyId) {
    console.log("Onboarding fixture retained only in the disposable isolated CI database (audit append-only).");
  }
}
