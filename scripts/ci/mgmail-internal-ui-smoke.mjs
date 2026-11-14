import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { randomBytes, randomUUID } from "node:crypto";

const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service=process.env.SUPABASE_SERVICE_ROLE_KEY;
const base=process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000";
if(!url||!anon||!service)throw new Error("Environnement isolé MGMail absent");
const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
const fixture=randomUUID().slice(0,12);
async function makeUser(role){
  const email=`mgmail-ui-${role}-${fixture}@magnisa.test`;
  const password=`MG-${randomBytes(18).toString("hex")}!a9`;
  const created=await admin.auth.admin.createUser({email,password,email_confirm:true});
  if(created.error||!created.data.user)throw created.error||new Error("Impossible de créer le compte MGMail UI");
  return {email,password,id:created.data.user.id};
}
const owner=await makeUser("owner");
const employee=await makeUser("employee");
const authenticated=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
const signed=await authenticated.auth.signInWithPassword({email:owner.email,password:owner.password});
if(signed.error)throw signed.error;
const {data:organizationId,error:orgError}=await authenticated.rpc("create_organization",{
  p_name:`Entreprise MGMail UI ${fixture}`,p_currency:"MGA"
});
if(orgError||typeof organizationId!=="string")throw orgError||new Error("Entreprise isolée indisponible");
const member=await admin.from("organization_members").insert({
  organization_id:organizationId,user_id:employee.id,role:"employee",status:"active"
});
if(member.error)throw member.error;

const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
async function login(user) {
  const context=await browser.newContext({viewport:{width:390,height:844}});
  const page=await context.newPage();
  await page.goto(base+"/login",{waitUntil:"domcontentloaded"});
  console.log("MGMail UI: connexion",user.email.includes("-owner-")?"administrateur":"collaborateur");
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button",{name:"Se connecter"}).click();
  await page.waitForURL(u=>u.pathname!=="/login",{timeout:30000});
  await page.locator('.mg-app[data-mg-hydrated="true"]').waitFor({timeout:25000});
  return {page,context};
}
// A streamed Next.js page can expose its trigger before the nested client dialog
// is interactive. Verify that the dialog really opened, retrying only lost clicks.
async function openDialog(page,label){
  const trigger=page.getByRole("button",{name:label});
  await trigger.waitFor({state:"visible",timeout:20000});
  for(let attempt=0;attempt<5;attempt++){
    await trigger.click();
    try{
      await page.getByRole("dialog").waitFor({state:"visible",timeout:1200});
      return;
    }catch{
      await page.waitForTimeout(250);
    }
  }
  throw new Error("MGMail : fenêtre inaccessible ("+String(label)+") à "+page.url()+
    ". Contenu : "+(await page.locator("body").innerText()).slice(0,1000));
}

try {
  const a=await login(owner);
  // Orbit must work with the same MAGNISA login and the existing tenant.
  await a.page.goto(base+"/orbit",{waitUntil:"domcontentloaded"});
  await a.page.getByRole("heading",{name:"Magnisa Orbit"}).waitFor({timeout:20000});
  for(const module of ["Magnisa Inbox","Magnisa Planner","Magnisa Time","Magnisa Action"]) {
    await a.page.getByRole("link",{name:module,exact:true}).first().waitFor({timeout:15000});
  }
  for(const [path,heading] of [
    ["/orbit/planner","Magnisa Planner"],
    ["/orbit/time","Magnisa Time"],
    ["/orbit/action","Magnisa Action"],
  ]) {
    await a.page.goto(base+path,{waitUntil:"domcontentloaded"});
    await a.page.getByRole("heading",{name:heading}).waitFor({timeout:20000});
  }
  await a.page.goto(base+"/orbit/inbox",{waitUntil:"domcontentloaded"});
  await a.page.locator('.mg-app[data-mg-hydrated="true"]').waitFor({timeout:25000});
  // MAGNIMAIL and MGMail are a single messaging workspace. An internal
  // message must be accessible here without entering a second application.
  await a.page.getByRole("heading",{name:"Magnisa Inbox",exact:true}).waitFor({timeout:20000});
  await a.page.getByRole("button",{name:"Configurer la messagerie interne"}).waitFor({timeout:20000});
  if(await a.page.getByRole("link",{name:"Ouvrir la messagerie interne"}).count())
    throw new Error("Orbit Inbox still separates MGMail into another messaging product");
  console.log("MGMail UI: messagerie interne hydratée");
  // Ignore empty aria-live/alert placeholders; only a substantive MGMail error is a failure.
  const mgmailAlerts=(await a.page.locator('main [role="alert"]').allTextContents())
    .map(message=>message.trim()).filter(message=>message.length>0);
  if(mgmailAlerts.length){
    // Capture which query is failing, not simply the existence of a global alert.
    const ownerProbe=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
    const ownerLogin=await ownerProbe.auth.signInWithPassword({
      email:owner.email,password:owner.password
    });
    if(ownerLogin.error)throw ownerLogin.error;
    const checks=[
      ["namespace",()=>ownerProbe.from("mgmail_internal_namespaces").select("slug").eq("organization_id",organizationId).maybeSingle()],
      ["mailboxes",()=>ownerProbe.from("mgmail_internal_mailboxes").select("id,local_part,owner_user_id,display_name,is_active,can_read,can_send").eq("organization_id",organizationId).order("local_part")],
      ["messages",()=>ownerProbe.from("mgmail_internal_messages").select("id,sender_mailbox_id,recipient_mailbox_id,subject,body_text,created_at").eq("organization_id",organizationId).order("created_at",{ascending:false}).limit(80)],
      ["grants",()=>ownerProbe.from("mgmail_internal_mailbox_grants").select("mailbox_id,user_id,can_read,can_send,is_active").eq("organization_id",organizationId)],
      ["reads",()=>ownerProbe.from("mgmail_internal_message_reads").select("message_id").eq("organization_id",organizationId).eq("user_id",owner.id)],
    ];
    const probe=await Promise.all(checks.map(async ([table,run])=>{
      const response=await run();
      return {table,status:response.status,error:response.error?.message,code:response.error?.code};
    }));
    throw new Error("MGMail a signalé : "+JSON.stringify({alerts:mgmailAlerts,probe,
      route:a.page.url(),view:(await a.page.locator("main").innerText()).slice(0,900)}));
  }

  await openDialog(a.page,"Configurer la messagerie interne");
  await a.page.locator('input[name="slug"]').fill("mgmail-ui-"+fixture);
  await a.page.getByRole("button",{name:"Créer cet espace"}).click();
  // The obsolete administration heading and internal-domain banner are intentionally removed.
  // Wait on a real functional control rather than on a deleted text heading.
  await a.page.getByRole("button",{name:/Créer une boîte/}).waitFor({timeout:20000});
  if(await a.page.getByRole("heading",{name:"Administration des boîtes"}).count()) {
    throw new Error("L'ancien titre MGMail a réapparu.");
  }
  if(await a.page.getByText(/Identifiant interne\s*:/).count()) {
    throw new Error("L'ancien identifiant .mgmail a réapparu.");
  }
  console.log("MGMail UI: espace interne créé");

  async function createMailbox(label,userId){
    await openDialog(a.page,/Créer une boîte/);
    await a.page.locator('input[name="localPart"]').fill(label);
    await a.page.locator('select[name="ownerId"]').selectOption(userId);
    await a.page.getByRole("button",{name:"Créer et attribuer la boîte"}).click();
    await a.page.getByRole("cell",{name:new RegExp(label+"@")}).first().waitFor({timeout:20000});
    console.log("MGMail UI: boîte attribuée",label);
  }
  await createMailbox("direction",owner.id);
  await createMailbox("finance",employee.id);
  const {data:boxes,error:boxesError}=await admin.from("mgmail_internal_mailboxes")
    .select("id,local_part").eq("organization_id",organizationId);
  if(boxesError)throw boxesError;
  const sender=boxes.find(x=>x.local_part==="direction")?.id;
  const recipient=boxes.find(x=>x.local_part==="finance")?.id;
  if(!sender||!recipient)throw new Error("Boîtes collaborateur non enregistrées");
  await openDialog(a.page,/Nouveau message/);
  await a.page.locator('select[name="senderId"]').selectOption(sender);
  await a.page.locator('select[name="recipientId"]').selectOption(recipient);
  const subject="Message interne "+fixture;
  await a.page.locator('input[name="subject"]').fill(subject);
  await a.page.locator('textarea[name="body"]').fill("Test sécurisé entre deux collaborateurs authentifiés.");
  await a.page.getByRole("button",{name:"Envoyer dans MAGNISA"}).click();
  await a.page.getByText(subject).first().waitFor({timeout:20000});
  console.log("MGMail UI: message envoyé");
  await a.context.close();

  const b=await login(employee);
  await b.page.goto(base+"/orbit/inbox",{waitUntil:"domcontentloaded"});
  await b.page.locator('.mg-app[data-mg-hydrated="true"]').waitFor({timeout:25000});
  await b.page.getByRole("heading",{name:"Magnisa Inbox",exact:true}).waitFor({timeout:20000});
  await b.page.getByText(subject).waitFor({timeout:20000});
  console.log("MGMail UI: message réceptionné par le collaborateur");
  await openDialog(b.page,/Marquer comme lu/);
  await b.page.getByRole("button",{name:"Confirmer"}).click();
  await b.page.getByRole("heading",{name:/Boîte de réception interne \(0 non lus affichés\)/}).waitFor({timeout:20000});
  if(await b.page.getByRole("button",{name:/Créer une boîte/}).count()>0)
    throw new Error("Un employé ne doit pas créer une boîte sans permission");
  const {data:reads,error:readError}=await admin.from("mgmail_internal_message_reads")
    .select("message_id,user_id").eq("user_id",employee.id).eq("organization_id",organizationId);
  if(readError||!reads?.length)throw readError||new Error("Lecture personnelle non enregistrée");
  if(await b.page.locator("html").evaluate(el=>el.scrollWidth>el.clientWidth+12))
    throw new Error("MGMail a un débordement horizontal sur mobile");
  await b.context.close();
  console.log("PASS MGMAIL UI: two users, mailbox creation, send, reception, read state, employee rights, mobile");
} finally {await browser.close();}
