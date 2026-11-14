import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000";
const email = process.env.TEST_EMAIL;
const password = process.env.TEST_PASSWORD;
if (!apiUrl || !anonKey || !email || !password) throw new Error("Environnement Supabase de test isolé requis.");

const supabase = createClient(apiUrl, anonKey, { auth: { autoRefreshToken:false, persistSession:false } });
const signed = await supabase.auth.signInWithPassword({ email, password });
if (signed.error) throw signed.error;
const claim = await supabase.rpc("claim_magnisa_identity", {
  p_full_name:"Compte de test MAGNISA", p_username:"",
  p_country:"261", p_locality:"601",
});
if (claim.error) throw new Error("Attribution du nom d'utilisateur test : "+claim.error.message);
const { data: assigned, error: profileError } = await supabase.from("profiles")
  .select("username").eq("id", signed.data.user.id).single();
if (profileError || !assigned || !/^[a-z]{2,10}$/.test(assigned.username || "")) {
  throw new Error("Le nom d'utilisateur automatique n'est pas disponible.");
}
const username = assigned.username;
await supabase.auth.signOut();

const browser = await chromium.launch({headless:true,args:["--no-sandbox"]});
try {
  const page = await browser.newPage({viewport:{width:390,height:844}});
  const errors = [];
  page.on("pageerror",e=>errors.push(e.message));
  await page.goto(baseUrl+"/login",{waitUntil:"domcontentloaded"});
  const identifier = page.locator('input[name="email"]');
  await identifier.waitFor({state:"visible",timeout:20000});
  await identifier.fill(username);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button",{name:"Se connecter"}).click();
  await page.waitForURL(u=>u.pathname==="/dashboard",{timeout:30000});
  await page.locator('.mg-app[data-mg-hydrated="true"]').waitFor({timeout:25000});

  await page.goto(baseUrl+"/mon-profil",{waitUntil:"domcontentloaded"});
  await page.locator('.mg-app[data-mg-hydrated="true"]').waitFor({timeout:25000});
  const pageText=await page.locator("main#contenu-principal").innerText();
  if(!pageText.includes(username))throw new Error("Le nom d'utilisateur est absent du profil.");
  if(!/\b[0-9]{14}\b/.test(pageText))throw new Error("L'ID public à 14 chiffres n'apparaît pas.");
  if(pageText.includes("261-601-") || pageText.includes("26160100000001"))throw new Error("Origine géographique exposée dans le profil.");
  console.log("PASS UI: connexion par nom d'utilisateur et profil numérique public");

  await page.goto(baseUrl+"/administration-identites",{waitUntil:"domcontentloaded"});
  await page.locator('.mg-app[data-mg-hydrated="true"]').waitFor({timeout:25000});
  const restricted=await page.getByText("Accès restreint").count();
  if(!restricted)throw new Error("Le propriétaire d'une entreprise peut lire le registre géographique de la plateforme.");
  if(errors.length)throw new Error("Erreurs navigateur : "+errors.join(" | "));
  console.log("PASS UI: registre géographique privé refusé au propriétaire d'entreprise");
} finally {
  await browser.close();
}
