import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { randomUUID, randomBytes } from "node:crypto";

const apiUrl=process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret=process.env.SUPABASE_SERVICE_ROLE_KEY;
const baseUrl=process.env.NEXT_PUBLIC_APP_URL||"http://127.0.0.1:3000";
if(!apiUrl||!secret)throw new Error("Isolated test environment required.");

const admin=createClient(apiUrl,secret,{auth:{persistSession:false,autoRefreshToken:false}});
// Create a dedicated fixture rather than adding another membership to the
// payroll/CRM/stock shared account. This entire DB is disposed after CI.
const email=`company-wizard-${randomUUID().slice(0,12)}@magnisa.test`;
const password=randomBytes(22).toString("hex");
const {data:createdUser,error:userError}=await admin.auth.admin.createUser({
  email,password,email_confirm:true,
});
if(userError||!createdUser?.user)throw userError??new Error("Cannot create dedicated onboarding test user");
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
try{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const errors=[];
  page.on("pageerror",e=>errors.push(e.message));
  await page.goto(baseUrl+"/login",{waitUntil:"domcontentloaded"});
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button",{name:"Se connecter"}).click();
  await page.waitForURL(u=>["/dashboard","/choisir-organisation","/onboarding","/espace-personnel"].includes(u.pathname),{timeout:30000});
  await page.goto(baseUrl+"/creer-entreprise",{waitUntil:"domcontentloaded"});
  await page.getByRole("heading",{name:"Créer une entreprise"}).waitFor({timeout:20000});
  await page.locator('main[data-onboarding-hydrated="true"]').waitFor({timeout:20000});
  if(await page.locator("html").evaluate(el=>el.scrollWidth>el.clientWidth+12))
    throw new Error("Wizard has unexpected mobile horizontal overflow");

  const companyName="Entreprise navigateur Morombe CI";
  // Real upload fixture: a valid tiny PNG with no commercial data.
  const pixel=Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAOa1ytYAAAAASUVORK5CYII=",
    "base64"
  );
  await page.locator("#company-color-logo").setInputFiles({
    name:"logo-couleur.png",mimeType:"image/png",buffer:pixel
  });
  await page.locator("#company-inverse-logo").setInputFiles({
    name:"logo-inverse.png",mimeType:"image/png",buffer:pixel
  });
  await page.locator("#co-legal-name").fill(companyName);
  await page.locator("#co-sector").selectOption("G");
  await page.locator("#co-group").waitFor({state:"visible",timeout:10000});
  await page.locator("#co-group").selectOption({label:"Commerce de détail"});
  await page.locator("#co-activity").selectOption({label:"Épicerie"});
  await page.getByRole("button",{name:"Suivant"}).click();
  await page.locator("#co-status").selectOption("pending");
  await page.getByRole("button",{name:"Suivant"}).click();
  await page.locator("#co-region").selectOption("908");
  await page.locator("#co-locality").fill("Ambahikily");
  const suggestion=page.getByRole("button",{name:/Ambahikily.*Morombe/}).first();
  await suggestion.waitFor({timeout:15000});
  await suggestion.click();
  await page.locator("#co-address").fill("Morombe, Atsimo-Andrefana");
  await page.getByRole("button",{name:"Suivant"}).click();
  await page.locator("#co-tax").selectOption("IS");
  await page.locator("#co-vat").selectOption("A_VERIFIER");
  await page.getByRole("button",{name:"Suivant"}).click();
  await page.getByRole("heading",{name:"Vérifier les données avant de créer l'espace"}).waitFor();
  if(!(await page.locator("main").innerText()).includes("Ambahikily"))
    throw new Error("Entered locality missing in final summary");
  await page.getByRole("button",{name:"Créer mon entreprise"}).click();
  await page.getByRole("heading",{name:"Entreprise créée"}).waitFor({timeout:30000});
  await page.getByText("Les logos choisis ont été traités.").waitFor({timeout:30000});
  const {data:created,error}=await admin.from("organizations")
    .select("id,name").eq("name",companyName).order("created_at",{ascending:false}).limit(1).single();
  if(error||!created?.id)throw error??new Error("No organization was persisted");
  const {data:settings,error:settingsError}=await admin.from("company_settings")
    .select("onboarding_profile,income_tax_regime,vat_status,logo_storage_path,logo_inverse_storage_path,document_theme").eq("organization_id",created.id).single();
  if(settingsError||!settings)throw settingsError??new Error("Company settings missing");
  const fields={
    tax:settings.income_tax_regime==="IS",
    region:settings.onboarding_profile?.regionCode==="908",
    locality:settings.onboarding_profile?.localityName==="Ambahikily",
    vat:settings.vat_status==="A_VERIFIER",
    colorLogo:typeof settings.logo_storage_path==="string" && settings.logo_storage_path.includes("/color-"),
    inverseLogo:typeof settings.logo_inverse_storage_path==="string" && settings.logo_inverse_storage_path.includes("/inverse-"),
    documentTheme:typeof settings.document_theme?.primaryColor==="string",
  };
  const failed=Object.entries(fields).filter(([,passed])=>!passed).map(([name])=>name);
  if(failed.length)throw new Error("Company onboarding persistence validation failed: "+failed.join(", "));
  await page.getByRole("link",{name:"Accéder aux paramètres de l'entreprise"}).click();
  await page.getByRole("heading",{name:"Paramètres de l'entreprise"}).waitFor({timeout:20000});
  if(errors.length)throw new Error("Browser errors: "+errors.join(" | "));
  console.log("PASS BROWSER: mobile five-step creation, real locality, declared IS/TVA, company settings");
}finally{await browser.close();}
