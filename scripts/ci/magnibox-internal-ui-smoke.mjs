import { chromium } from "playwright";
import { seedAdultMajorityFixture, stageAdultMajorityFixture } from "./majority-fixtures.mjs";
import { createClient } from "@supabase/supabase-js";
import { randomBytes, randomUUID } from "node:crypto";

const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service=process.env.SUPABASE_SERVICE_ROLE_KEY;
const base=process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000";
if(!url||!anon||!service)throw new Error("Environnement isolé MAGNIBOX absent");
const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
const fixture=randomUUID().slice(0,12);
async function makeUser(role){
  const email=`magnibox-ui-${role}-${fixture}@magnisa.test`;
  const password=`MG-${randomBytes(18).toString("hex")}!a9`;
  await stageAdultMajorityFixture(admin,email);
  const created=await admin.auth.admin.createUser({email,password,email_confirm:true});
  if(created.error||!created.data.user)throw created.error||new Error("Impossible de créer le compte MAGNIBOX UI");
  await seedAdultMajorityFixture(admin,created.data.user.id);
  return {email,password,id:created.data.user.id};
}
const owner=await makeUser("owner");
const employee=await makeUser("employee");
const authenticated=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
const signed=await authenticated.auth.signInWithPassword({email:owner.email,password:owner.password});
if(signed.error)throw signed.error;
const {data:organizationId,error:orgError}=await authenticated.rpc("create_organization",{
  p_name:`Entreprise MAGNIBOX UI ${fixture}`,p_currency:"MGA"
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
  console.log("MAGNIBOX UI: connexion",user.email.includes("-owner-")?"administrateur":"collaborateur");
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button",{name:"Se connecter"}).click();
  await page.waitForURL(u=>u.pathname!=="/login",{timeout:30000});
  await page.locator("main").waitFor({timeout:25000});
  return {page,context};
}
// A streamed Next.js page can expose its trigger before the nested client dialog
// is interactive. Verify that the dialog really opened, retrying only lost clicks.
async function reloadForFreshRender(page){
  // Server Actions may still be completing a Next.js route refresh when the
  // test asks Playwright to reload. Retry transient aborted navigations, then
  // force a fresh document navigation before asserting persisted server data.
  for(let attempt=0;attempt<2;attempt++){
    try{
      await page.reload({waitUntil:"domcontentloaded",timeout:30000});
      await page.getByRole("heading",{name:"Messagerie",exact:true}).waitFor({state:"visible",timeout:20000});
      return;
    }catch(error){
      const message=String(error);
      if(!/ERR_ABORTED|frame was detached|Navigation interrupted/i.test(message))throw error;
      await page.waitForTimeout(500);
    }
  }
  const currentUrl=page.url();
  await page.goto(currentUrl,{waitUntil:"domcontentloaded",timeout:30000});
  await page.getByRole("heading",{name:"Messagerie",exact:true}).waitFor({state:"visible",timeout:20000});
}

async function openDialog(page,label,scope=page){
  const trigger=scope.getByRole("button",{name:label});
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
  throw new Error("MAGNIBOX : fenêtre inaccessible ("+String(label)+") à "+page.url()+
    ". Contenu : "+(await page.locator("body").innerText()).slice(0,1000));
}

try {
  const a=await login(owner);
  // Orbit must work with the same MAGNISA login and the existing tenant.
  await a.page.goto(base+"/orbit",{waitUntil:"domcontentloaded"});
  await a.page.getByRole("heading",{name:"Magnisa Orbit"}).waitFor({timeout:20000});
  for(const module of ["Magnibox","Magnisa Planner","Magnisa Time","Magnisa Action"]) {
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
  // Use only the MAGNIBOX workspace; legacy messaging routes are not browser-test targets.
  await a.page.goto(base+"/orbit/magnibox",{waitUntil:"domcontentloaded"});
  await a.page.getByRole("heading",{name:"Bienvenue dans MAGNIBOX"}).waitFor({timeout:20000});
  await a.page.getByRole("link",{name:"Ouvrir la messagerie"}).waitFor({timeout:15000});
  await a.page.goto(base+"/orbit/magnibox/boites",{waitUntil:"domcontentloaded"});
  await a.page.getByRole("heading",{name:"Boîtes et collaborateurs"}).waitFor({timeout:20000});
  console.log("SCENARIO 1/7: navigation MAGNIBOX et espace des boîtes");
  await a.page.getByRole("button",{name:"Configurer la messagerie interne"}).waitFor({timeout:20000});
  if(await a.page.getByRole("link",{name:"Ouvrir la messagerie interne"}).count())
    throw new Error("Orbit Inbox still separates MAGNIBOX into another messaging product");
  console.log("MAGNIBOX UI: messagerie interne hydratée");
  // Ignore empty aria-live/alert placeholders; only a substantive MAGNIBOX error is a failure.
  const magniboxAlerts=(await a.page.locator('main [role="alert"]').allTextContents())
    .map(message=>message.trim()).filter(message=>message.length>0);
  if(magniboxAlerts.length){
    // Capture which query is failing, not simply the existence of a global alert.
    const ownerProbe=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
    const ownerLogin=await ownerProbe.auth.signInWithPassword({
      email:owner.email,password:owner.password
    });
    if(ownerLogin.error)throw ownerLogin.error;
    const checks=[
      ["namespace",()=>ownerProbe.from("magnibox_internal_namespaces").select("slug").eq("organization_id",organizationId).maybeSingle()],
      ["mailboxes",()=>ownerProbe.from("magnibox_internal_mailboxes").select("id,local_part,owner_user_id,display_name,is_active,can_read,can_send").eq("organization_id",organizationId).order("local_part")],
      ["messages",()=>ownerProbe.from("magnibox_internal_messages").select("id,sender_mailbox_id,recipient_mailbox_id,subject,body_text,created_at").eq("organization_id",organizationId).order("created_at",{ascending:false}).limit(80)],
      ["grants",()=>ownerProbe.from("magnibox_internal_mailbox_grants").select("mailbox_id,user_id,can_read,can_send,is_active").eq("organization_id",organizationId)],
      ["reads",()=>ownerProbe.from("magnibox_internal_message_reads").select("message_id").eq("organization_id",organizationId).eq("user_id",owner.id)],
    ];
    const probe=await Promise.all(checks.map(async ([table,run])=>{
      const response=await run();
      return {table,status:response.status,error:response.error?.message,code:response.error?.code};
    }));
    throw new Error("MAGNIBOX a signalé : "+JSON.stringify({alerts:magniboxAlerts,probe,
      route:a.page.url(),view:(await a.page.locator("main").innerText()).slice(0,900)}));
  }

  await openDialog(a.page,"Configurer la messagerie interne");
  await a.page.locator('input[name="slug"]').fill("magnibox-ui-"+fixture);
  await a.page.getByRole("button",{name:"Créer cet espace"}).click();
  // The obsolete administration heading and internal-domain banner are intentionally removed.
  // Wait on a real functional control rather than on a deleted text heading.
  await a.page.getByRole("button",{name:/Créer une boîte/}).waitFor({timeout:20000});
  if(await a.page.getByRole("heading",{name:"Administration des boîtes"}).count()) {
    throw new Error("L'ancien titre MAGNIBOX a réapparu.");
  }
  if(await a.page.getByText(/Identifiant interne\s*:/).count()) {
    throw new Error("L'ancien identifiant .magnibox a réapparu.");
  }
  if((await a.page.locator("main").innerText()).includes(".magnibox")) {
    throw new Error("Une ancienne extension de boîte interne apparaît encore dans Magnibox.");
  }
  console.log("MAGNIBOX UI: espace interne créé");

  async function createMailbox(label,userId){
    await openDialog(a.page,/Créer une boîte/);
    await a.page.locator('input[name="localPart"]').fill(label);
    await a.page.locator('select[name="ownerId"]').selectOption(userId);
    await a.page.getByRole("button",{name:"Créer et attribuer la boîte"}).click();
    await a.page.getByRole("cell",{name:new RegExp("^"+label+" \\(")}).first().waitFor({timeout:20000});
    console.log("MAGNIBOX UI: boîte attribuée",label);
  }
  await createMailbox("direction",owner.id);
  await createMailbox("finance",employee.id);
  await createMailbox("archives",owner.id);
  console.log("SCENARIO 2/7: création et attribution des boîtes");
  const {data:boxes,error:boxesError}=await admin.from("magnibox_internal_mailboxes")
    .select("id,local_part").eq("organization_id",organizationId);
  if(boxesError)throw boxesError;
  const sender=boxes.find(x=>x.local_part==="direction")?.id;
  const recipient=boxes.find(x=>x.local_part==="finance")?.id;
  const archive=boxes.find(x=>x.local_part==="archives")?.id;
  if(!sender||!recipient||!archive)throw new Error("Boîtes collaborateur non enregistrées");
  // The organization controls its own professional requests inside Magnibox.
  await a.page.goto(base+"/orbit/magnibox/domaines",{waitUntil:"domcontentloaded"});
  await a.page.getByRole("heading",{name:"Domaines et adresses professionnelles"}).waitFor({timeout:20000});
  if(new URL(a.page.url()).pathname!=="/orbit/magnibox/domaines")
    throw Error("Professional domains must open inside Magnibox");
  await openDialog(a.page,"+ Demander un domaine");
  const requestedDomain="magnibox-"+fixture+".example.org";
  await a.page.locator('input[name="domainName"]').fill(requestedDomain);
  await a.page.getByRole("button",{name:"Enregistrer la demande"}).click();
  await a.page.getByRole("cell",{name:requestedDomain}).waitFor({timeout:20000});
  const {data:domainRequest,error:domainError}=await admin.from("magnibox_domain_requests")
    .select("id,verification_token,status").eq("organization_id",organizationId)
    .eq("domain_name",requestedDomain).single();
  if(domainError||!domainRequest)throw domainError||Error("DNS challenge missing");
  if(domainRequest.status!=="pending")throw Error("Domain must not auto-activate");
  await a.page.getByRole("link",{name:"Vérifier le domaine et les DNS"}).click();
  await a.page.getByRole("heading",{name:"Vérifier "+requestedDomain}).waitFor({timeout:30000});
  await a.page.getByText("magnisa-orbit="+domainRequest.verification_token).waitFor({timeout:30000});
  if(await a.page.getByRole("button",{name:"Valider le domaine"}).count())
    throw Error("Domain may not be validated without real DNS proof");
  await a.page.goto(base+"/orbit/magnibox/domaines",{waitUntil:"domcontentloaded"});
  await openDialog(a.page,"+ Demander une adresse");
  await a.page.locator('select[name="domainRequestId"]').selectOption({label:requestedDomain});
  await a.page.locator('select[name="mailboxId"]').selectOption(recipient);
  await a.page.locator('input[name="localPart"]').fill("finance");
  await a.page.getByRole("button",{name:"Enregistrer la demande"}).click();
  await a.page.getByRole("cell",{name:"finance@"+requestedDomain}).waitFor({timeout:20000});
  console.log("SCENARIO 3/7: demandes de domaine et d’adresse avec validation DNS");
  // Domain administration is a separate route; return to the inbox and wait for hydration.
  await a.page.goto(base+"/orbit/magnibox/messagerie",{waitUntil:"domcontentloaded"});
  await a.page.getByRole("heading",{name:"Messagerie",exact:true}).waitFor({timeout:20000});
  await openDialog(a.page,/Nouveau message/);
  await a.page.locator('select[name="senderId"]').selectOption(sender);
  // Drafts are allowed to be incomplete: the submitter's formNoValidate must
  // override required recipient/subject/body controls in FormValidityGuard.
  const subject="Message interne "+fixture;
  const saveDraftButton=a.page.getByRole("button",{name:"Enregistrer le brouillon"});
  if(await saveDraftButton.isDisabled()) {
    throw new Error("Le bouton de sauvegarde d'un brouillon incomplet ne doit pas être désactivé par la validation HTML.");
  }
  await saveDraftButton.click();
  await a.page.getByRole("heading",{name:"Brouillons (1)"}).waitFor({timeout:20000});
  const initialDraftCard=a.page.getByTestId("magnibox-internal-draft").first();
  await initialDraftCard.waitFor({state:"visible",timeout:15000});
  await openDialog(a.page,"Ouvrir",initialDraftCard);
  await a.page.locator('select[name="recipientId"]').selectOption(recipient);
  await a.page.locator('input[name="subject"]').fill(subject);
  await a.page.locator('textarea[name="body"]').fill("Test sécurisé entre deux collaborateurs authentifiés.");
  await a.page.getByRole("button",{name:"Enregistrer les modifications"}).click();
  await a.page.getByRole("heading",{name:"Brouillons (1)"}).waitFor({timeout:20000});
  const persistedDraft=await admin.from("magnibox_internal_drafts").select("body_text")
    .eq("organization_id",organizationId).eq("subject",subject).single();
  if(persistedDraft.error||persistedDraft.data?.body_text!=="Test sécurisé entre deux collaborateurs authentifiés.")
    throw persistedDraft.error||new Error("La modification du brouillon n'a pas été persistée en base.");
  await openDialog(a.page,"Ouvrir",initialDraftCard);
  if(await a.page.locator('textarea[name="body"]').inputValue()!=="Test sécurisé entre deux collaborateurs authentifiés.")
    throw new Error("Le contenu modifié du brouillon n'a pas été conservé.");
  await a.page.getByRole("button",{name:"Envoyer dans MAGNISA"}).click();
  await a.page.getByRole("heading",{name:"Brouillons (0)"}).waitFor({timeout:20000});
  const sentMessage=await admin.from("magnibox_internal_messages").select("id,subject,body_text")
    .eq("organization_id",organizationId).eq("subject",subject).single();
  if(sentMessage.error||sentMessage.data?.body_text!=="Test sécurisé entre deux collaborateurs authentifiés.")
    throw sentMessage.error||new Error("Le message envoyé n’a pas été persisté avec son contenu.");

  console.log("SCENARIO 4/7: cycle brouillon, modification et envoi interne");

  // A send-only mailbox must still show its own Sent copy, while read access
  // remains independently revocable. Restore read access for the reply scenario.
  const sendOnlyUpdate=await admin.from("magnibox_internal_mailboxes")
    .update({can_read:false}).eq("id",sender).eq("organization_id",organizationId);
  if(sendOnlyUpdate.error)throw sendOnlyUpdate.error;
  await reloadForFreshRender(a.page);
  const sendOnlyCard=a.page.getByTestId("magnibox-message-card")
    .filter({has:a.page.getByText(subject,{exact:true})}).first();
  await sendOnlyCard.waitFor({state:"visible",timeout:15000});
  const restoreRead=await admin.from("magnibox_internal_mailboxes")
    .update({can_read:true}).eq("id",sender).eq("organization_id",organizationId);
  if(restoreRead.error)throw restoreRead.error;
  await reloadForFreshRender(a.page);

  // Personal folders are private to each collaborator and support filing/unfiling.
  const folderName="Factures "+fixture;
  await a.page.getByRole("textbox",{name:"Nom du nouveau dossier"}).fill(folderName);
  await a.page.getByRole("button",{name:"Créer un dossier"}).click();
  const folderLink=a.page.getByRole("link",{name:folderName,exact:true});
  await folderLink.waitFor({timeout:20000});
  const sentCard=a.page.getByTestId("magnibox-message-card")
    .filter({has:a.page.getByText(subject,{exact:true})}).first();
  await sentCard.waitFor({state:"visible",timeout:15000});
  await sentCard.locator('select[name="folderId"]').selectOption({label:folderName});
  await sentCard.getByRole("button",{name:"Classer"}).click();
  // Server Actions revalidate the route; reload once to assert the persisted
  // assignment from a fresh server render rather than matching a hidden option.
  await reloadForFreshRender(a.page);
  const refreshedCard=a.page.getByTestId("magnibox-message-card")
    .filter({has:a.page.getByText(subject,{exact:true})}).first();
  await refreshedCard.getByTestId("magnibox-message-folders")
    .getByText(folderName,{exact:false}).waitFor({state:"visible",timeout:20000});
  await folderLink.click();
  await a.page.getByText(subject,{exact:true}).waitFor({timeout:20000});
  await a.page.getByText("Dossiers personnels",{exact:true}).waitFor({timeout:15000});
  console.log("SCENARIO 5/7: dossiers personnels, classement et recherche");

  // A second unsent draft must remain private to its author.
  await openDialog(a.page,/Nouveau message/);
  await a.page.locator('select[name="senderId"]').selectOption(sender);
  const privateDraft="Brouillon privé "+fixture;
  await a.page.locator('input[name="subject"]').fill(privateDraft);
  await a.page.locator('textarea[name="body"]').fill("Contenu privé du brouillon administrateur.");
  await a.page.getByRole("button",{name:"Enregistrer le brouillon"}).click();
  await a.page.getByRole("heading",{name:"Brouillons (1)"}).waitFor({timeout:20000});

  // Search is tenant-scoped and includes both message bodies and private drafts.
  await a.page.locator('input[name="q"]').fill(subject);
  await a.page.getByRole("button",{name:"Rechercher"}).click();
  await a.page.waitForURL(url=>url.searchParams.get("q")===subject,{timeout:20000});
  await a.page.getByText(subject).first().waitFor({timeout:20000});
  await a.page.locator('input[name="q"]').fill(privateDraft);
  await a.page.getByRole("button",{name:"Rechercher"}).click();
  await a.page.waitForURL(url=>url.searchParams.get("q")===privateDraft,{timeout:20000});
  await a.page.getByRole("heading",{name:"Brouillons (1)"}).waitFor({timeout:20000});
  await a.page.getByText(privateDraft,{exact:true}).waitFor({timeout:15000});
  await a.page.goto(base+"/orbit/magnibox/messagerie",{waitUntil:"domcontentloaded"});
  await a.context.close();

  const b=await login(employee);
  await b.page.goto(base+"/orbit/magnibox/domaines/"+domainRequest.id,{waitUntil:"domcontentloaded"});
  await b.page.getByRole("alert").waitFor({timeout:20000});
  if(await b.page.getByText("magnisa-orbit="+domainRequest.verification_token).count())
    throw Error("Collaborator can read a domain ownership challenge");
  await b.page.goto(base+"/orbit/magnibox/messagerie",{waitUntil:"domcontentloaded"});
  await b.page.getByRole("heading",{name:"Messagerie",exact:true}).waitFor({timeout:20000});
  await b.page.getByRole("heading",{name:"Brouillons (0)"}).waitFor({timeout:20000});
  const employeeProbe=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
  const employeeLogin=await employeeProbe.auth.signInWithPassword({email:employee.email,password:employee.password});
  if(employeeLogin.error)throw employeeLogin.error;
  const privateDraftRows=await employeeProbe.from("magnibox_internal_drafts").select("id").eq("organization_id",organizationId);
  if(privateDraftRows.error||(privateDraftRows.data??[]).length!==0)
    throw new Error("Un collaborateur peut lire les brouillons privés d'un autre utilisateur.");
  const sentForEmployee=await admin.from("magnibox_internal_messages")
    .select("id,recipient_mailbox_id,subject").eq("organization_id",organizationId).eq("subject",subject).single();
  const employeeMailbox=await admin.from("magnibox_internal_mailboxes")
    .select("id,owner_user_id,is_active,can_read").eq("id",recipient).single();
  if(sentForEmployee.error||employeeMailbox.error
    ||sentForEmployee.data?.recipient_mailbox_id!==recipient
    ||employeeMailbox.data?.owner_user_id!==employee.id
    ||employeeMailbox.data?.is_active!==true||employeeMailbox.data?.can_read!==true) {
    throw new Error("Contrôle de livraison MAGNIBOX incohérent : "+JSON.stringify({
      message:sentForEmployee.data,error:sentForEmployee.error?.message,
      mailbox:employeeMailbox.data,mailboxError:employeeMailbox.error?.message,
      expectedRecipient:recipient,expectedOwner:employee.id
    }));
  }
  const employeeMessageProbe=await employeeProbe.from("magnibox_internal_messages")
    .select("id,recipient_mailbox_id,subject").eq("id",sentForEmployee.data.id).maybeSingle();
  if(employeeMessageProbe.error||!employeeMessageProbe.data) {
    throw new Error("Message persistant mais invisible sous la session du destinataire (RLS) : "+JSON.stringify({
      messageId:sentForEmployee.data.id,recipient:recipient,
      rlsError:employeeMessageProbe.error?.message,rlsCode:employeeMessageProbe.error?.code
    }));
  }
  const employeeMessageCard=b.page.getByTestId("magnibox-message-card")
    .filter({has:b.page.getByText(subject,{exact:true})}).first();
  try {
    await employeeMessageCard.waitFor({state:"visible",timeout:8000});
  } catch {
    await b.page.reload({waitUntil:"domcontentloaded"});
    await b.page.getByRole("heading",{name:"Messagerie",exact:true}).waitFor({timeout:20000});
    await employeeMessageCard.waitFor({state:"visible",timeout:15000});
  }
  console.log("MAGNIBOX UI: message réceptionné par le collaborateur");
  // Reply must return to the original sender using the employee's authorized mailbox.
  await openDialog(b.page,/Répondre/);
  const replySubject="Re : "+subject;
  await b.page.locator('textarea[name="body"]').fill("Réponse de test\n\n--- Message d'origine ---\nMessage cité");
  await b.page.getByRole("button",{name:"Envoyer la réponse"}).click();
  await b.page.getByText(replySubject).first().waitFor({timeout:20000});
  console.log("SCENARIO 6/7: réception, lecture et réponse entre collaborateurs");

  const c=await login(owner);
  await c.page.goto(base+"/orbit/magnibox/messagerie",{waitUntil:"domcontentloaded"});
  await c.page.getByText(replySubject).first().waitFor({timeout:20000});
  // Forward the received reply to a third internal mailbox.
  const replyRow=c.page.locator('div[style*="border-bottom"]').filter({has:c.page.getByText(replySubject,{exact:true})});
  if(await replyRow.count()!==1)throw new Error("Impossible d’identifier une seule carte pour le message à transférer : "+await replyRow.count());
  await openDialog(c.page,/Transférer/,replyRow);
  await c.page.locator('select[name="senderId"]').selectOption(sender);
  await c.page.locator('select[name="recipientId"]').selectOption(archive);
  await c.page.getByRole("button",{name:"Transférer le message"}).click();
  const forwardedSubject="Tr : "+replySubject;
  await c.page.getByText(forwardedSubject).first().waitFor({timeout:20000});
  console.log("SCENARIO 7/7: transfert, confidentialité, droits et affichage mobile");
  await c.page.getByText(privateDraft,{exact:true}).waitFor({timeout:15000});
  const draftCard=c.page.locator("div").filter({has:c.page.getByText(privateDraft,{exact:true})}).filter({has:c.page.getByRole("button",{name:"Supprimer le brouillon"})}).first();
  await draftCard.getByRole("button",{name:"Supprimer le brouillon"}).click();
  await c.page.getByRole("heading",{name:"Brouillons (0)"}).waitFor({timeout:20000});
  await c.context.close();

  await openDialog(b.page,/Marquer comme lu/);
  await b.page.getByRole("button",{name:"Confirmer"}).click();
  await b.page.getByRole("heading",{name:/Boîte de réception interne \(0 non lus affichés\)/}).waitFor({timeout:20000});
  if(await b.page.getByRole("button",{name:/Créer une boîte/}).count()>0)
    throw new Error("Un employé ne doit pas créer une boîte sans permission");
  const {data:reads,error:readError}=await admin.from("magnibox_internal_message_reads")
    .select("message_id,user_id").eq("user_id",employee.id).eq("organization_id",organizationId);
  if(readError||!reads?.length)throw readError||new Error("Lecture personnelle non enregistrée");
  if(await b.page.locator("html").evaluate(el=>el.scrollWidth>el.clientWidth+12))
    throw new Error("MAGNIBOX a un débordement horizontal sur mobile");
  await b.context.close();
  console.log("PASS MAGNIBOX UI: two users, mailbox creation, send, reception, read state, employee rights, mobile");
} finally {await browser.close();}
