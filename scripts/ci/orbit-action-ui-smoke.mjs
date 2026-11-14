import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { randomUUID, randomBytes } from "node:crypto";

const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service=process.env.SUPABASE_SERVICE_ROLE_KEY;
const base=process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000";
if(!url||!anon||!service)throw Error("Orbit Action browser requires disposable Supabase.");
const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
const fixture=randomUUID().slice(0,10);
const email=`action-ui-${fixture}@magnisa.test`;
const password=`Action-${randomBytes(18).toString("hex")}!a9`;
const account=await admin.auth.admin.createUser({email,password,email_confirm:true});
if(account.error||!account.data.user)throw account.error||Error("Action browser user unavailable");
const owner=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
const signin=await owner.auth.signInWithPassword({email,password});
if(signin.error)throw signin.error;
const org=await owner.rpc("create_organization",{
  p_name:`Orbit Action UI ${fixture}`,p_currency:"MGA",
});
if(org.error||typeof org.data!=="string")throw org.error||Error("Action browser organization unavailable");

const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
try {
  const context=await browser.newContext({viewport:{width:390,height:844}});
  const page=await context.newPage();
  await page.goto(base+"/login",{waitUntil:"domcontentloaded"});
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button",{name:"Se connecter"}).click();
  await page.waitForURL(u=>u.pathname!=="/login",{timeout:30000});
  await page.goto(base+"/orbit/action/taches",{waitUntil:"domcontentloaded"});
  await page.locator('.mg-app[data-mg-hydrated="true"]').waitFor({timeout:25000});
  await page.getByRole("heading",{name:"Tâches et responsabilités"}).waitFor({timeout:20000});
  if((await page.locator('main [role="alert"]').allTextContents()).some(v=>v.trim())){
    throw Error("Action UI blocked despite local migration");
  }

  async function openDialog(label){
    const trigger=page.getByRole("button",{name:label});
    await trigger.waitFor({state:"visible",timeout:20000});
    for(let attempt=0;attempt<5;attempt++){
      await trigger.click();
      try{await page.getByRole("dialog").waitFor({state:"visible",timeout:1500});return;}
      catch{await page.waitForTimeout(250);}
    }
    throw Error("Action modal not interactive: "+String(label));
  }
  const title=`Tâche UI ${fixture}`;
  await openDialog("+ Créer une tâche");
  await page.locator('input[name="title"]').fill(title);
  await page.locator('select[name="priority"]').selectOption("high");
  await page.getByRole("button",{name:"Enregistrer la tâche"}).click();
  await page.getByText(title).waitFor({timeout:20000});
  const created=await admin.from("orbit_action_tasks")
    .select("id,status,organization_id")
    .eq("organization_id",org.data).eq("title",title).single();
  if(created.error||!created.data)throw created.error||Error("Task not persisted");
  if(created.data.status!=="todo")throw Error("Created task should be todo");

  await openDialog("Changer l'état");
  await page.locator('select[name="status"]').selectOption("in_progress");
  await page.getByRole("button",{name:"Enregistrer"}).click();
  const taskStatus=await admin.from("orbit_action_tasks").select("status")
    .eq("id",created.data.id).single();
  if(taskStatus.error||taskStatus.data.status!=="in_progress")
    throw Error("Task progression not persisted");

  await openDialog("Commenter");
  await page.locator('textarea[name="body"]').fill("Commentaire de suivi Orbit Action.");
  await page.getByRole("button",{name:"Publier le commentaire"}).click();
  const c=await admin.from("orbit_action_comments").select("id")
    .eq("organization_id",org.data).eq("task_id",created.data.id);
  if(c.error||c.data.length!==1)throw Error("Task comment not persisted");

  await openDialog("+ Sous-tâche");
  await page.locator('input[name="title"]').fill(`Sous-tâche ${fixture}`);
  await page.getByRole("button",{name:"Créer la sous-tâche"}).click();
  const children=await admin.from("orbit_action_tasks").select("id")
    .eq("organization_id",org.data).eq("parent_task_id",created.data.id);
  if(children.error||children.data.length!==1)throw Error("Subtask not persisted");

  if(await page.locator("html").evaluate(el=>el.scrollWidth>el.clientWidth+12))
    throw Error("Orbit Action mobile horizontal overflow");
  await context.close();
  console.log("PASS Orbit Action UI: authenticated task, status, comment, subtask and mobile layout.");
} finally {await browser.close();}
