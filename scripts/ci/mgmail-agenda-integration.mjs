import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!anon||!service) throw Error("Test MGMail agenda : configuration Supabase isolée manquante.");
const client=(key)=>createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}});
const admin=client(service), owner=client(anon);
const suffix=randomUUID().slice(0,8);

// The replay seeds this fixture itself. Do not rely on payroll/CRM fixtures
// or on a later step in the shared migration workflow.
const email=`mgmail-agenda-owner-${suffix}@magnisa.test`;
const password=`MG-${randomBytes(18).toString("hex")}!a9`;
const createdOwner=await admin.auth.admin.createUser({email,password,email_confirm:true});
if(createdOwner.error||!createdOwner.data.user)throw createdOwner.error??Error("Compte de recette agenda indisponible.");
const session=await owner.auth.signInWithPassword({email,password});
if(session.error||session.data.user?.id!==createdOwner.data.user.id)throw session.error??Error("Connexion propriétaire indisponible.");
const ownerId=createdOwner.data.user.id;
const orgResult=await owner.rpc("create_organization",{
  p_name:`MGMail Agenda CI ${suffix}`, p_currency:"MGA",
});
if(orgResult.error||typeof orgResult.data!=="string")throw orgResult.error??Error("Entreprise de recette agenda indisponible.");
const org=orgResult.data;
const check=(v,msg)=>{if(!v)throw Error(msg);};
const ok=(result,label)=>{if(result.error)throw Error(label+": "+result.error.message);return result.data;};
const noRows=(result,label)=>{if(result.error)return;check(Array.isArray(result.data)&&result.data.length===0,label+": données non autorisées visibles");};

async function employee(department) {
  const mail=`mgmail-agenda-${suffix}-${department.toLowerCase()}@magnisa.test`;
  const pass=`Ag-${randomBytes(17).toString("hex")}!a9`;
  const created=await admin.auth.admin.createUser({email:mail,password:pass,email_confirm:true});
  if(created.error||!created.data.user)throw created.error??Error("Collaborateur de test absent.");
  const id=created.data.user.id;
  ok(await admin.from("organization_members").insert({
    organization_id:org,user_id:id,role:"employee",status:"active",department,
  }),"Adhésion agenda");
  const account=client(anon);
  const auth=await account.auth.signInWithPassword({email:mail,password:pass});
  if(auth.error)throw auth.error;
  return {id,account};
}
const finance=await employee("Finance");
const direction=await employee("Direction");
const event=(created_by,scope,department,title)=>({
  organization_id:org,created_by,scope,department,title,
  description:"Événement factice de recette isolée",
  start_day:"2026-12-10",start_time:"09:00",
  end_day:"2026-12-10",end_time:"10:00",
  time_zone:"Indian/Antananarivo",reminder_days:[15,5,1],
});
const privateOwner=ok(await owner.from("mgmail_agenda_events")
  .insert(event(ownerId,"personal",null,`Agenda privé direction ${suffix}`))
  .select("id").single(),"Agenda personnel owner").id;
const privateFinance=ok(await finance.account.from("mgmail_agenda_events")
  .insert(event(finance.id,"personal",null,`Agenda privé finance ${suffix}`))
  .select("id").single(),"Agenda personnel collaborateur").id;

noRows(await direction.account.from("mgmail_agenda_events")
  .select("id").in("id",[privateOwner,privateFinance]),"Confidentialité personnelle entre salariés");
noRows(await owner.from("mgmail_agenda_events")
  .select("id").eq("id",privateFinance),"Confidentialité personnelle même pour le directeur");

const company=ok(await owner.from("mgmail_agenda_events")
  .insert(event(ownerId,"company",null,`Réunion générale ${suffix}`))
  .select("id").single(),"Agenda entreprise").id;
const serviceFinance=ok(await owner.from("mgmail_agenda_events")
  .insert(event(ownerId,"service","Finance",`Réunion finance ${suffix}`))
  .select("id").single(),"Agenda service").id;

const readable=async(account,id)=>ok(await account.from("mgmail_agenda_events")
  .select("id").eq("id",id),"Lecture agenda").length===1;
check(await readable(finance.account,company),"Un employé doit voir l'agenda entreprise.");
check(await readable(direction.account,company),"Une autre équipe doit voir l'agenda entreprise.");
check(await readable(finance.account,serviceFinance),"Le service Finance doit voir son agenda.");
check(!await readable(direction.account,serviceFinance),"Le service Direction ne doit pas voir Finance.");

noRows(await finance.account.from("mgmail_agenda_events")
  .insert(event(finance.id,"company",null,"Publication non autorisée"))
  .select("id"),"Publication d'entreprise par employé");
noRows(await direction.account.from("mgmail_agenda_events")
  .insert(event(direction.id,"service","Finance","Événement hors département"))
  .select("id"),"Usurpation de département");

const financeService=ok(await finance.account.from("mgmail_agenda_events")
  .insert(event(finance.id,"service","Finance",`Point équipe Finance ${suffix}`))
  .select("id").single(),"Création dans son propre département").id;
check(await readable(finance.account,financeService),"Événement créé non visible.");

// Les rappels d'agenda passent uniquement par la routine serveur existante.
// Le traitement et ses doublons sont testés sur une date locale déterministe.
const forbiddenCron=await finance.account.rpc("run_mgmail_agenda_reminders",{
  p_run_at:"2026-12-09T05:00:00.000Z",
});
check(!!forbiddenCron.error,"Un collaborateur ne peut pas déclencher le moteur global.");
const runAt="2026-12-09T05:00:00.000Z";
const createdReminders=ok(await admin.rpc("run_mgmail_agenda_reminders",{
  p_run_at:runAt,
}),"Exécution serveur du rappel");
check(createdReminders>=7,"Les rappels attendus ne sont pas créés.");

const readNotices=(account,id)=>account.from("notifications").select("id")
  .eq("organization_id",org).eq("entity_id",id);
for(const [person,account] of [[ownerId,owner],[finance.id,finance.account],[direction.id,direction.account]]) {
  const companyNotices=ok(await readNotices(account,company),"Notification entreprise");
  check(companyNotices.length===1,"Les collaborateurs actifs doivent être notifiés pour l'entreprise.");
}
check(ok(await readNotices(finance.account,serviceFinance),"Service Finance").length===1,
  "Le service Finance ne reçoit pas son alerte.");
check(ok(await readNotices(direction.account,serviceFinance),"Service Direction").length===0,
  "Un autre service ne doit pas recevoir un rappel interne à Finance.");
check(ok(await readNotices(owner,privateFinance),"Privé Finance").length===0,
  "Un administrateur ne doit pas recevoir les rappels privés des collaborateurs.");
check(ok(await readNotices(finance.account,privateFinance),"Personnel Finance").length===1,
  "Le créateur doit recevoir son rappel personnel.");
const retried=ok(await admin.rpc("run_mgmail_agenda_reminders",{p_run_at:runAt}),
  "Relance du moteur");
check(retried===0,"Une nouvelle exécution ne doit pas dupliquer les notifications.");

const wrongEdit=await direction.account.from("mgmail_agenda_events")
  .update({title:"Modification non autorisée"}).eq("id",company).select("id");
noRows(wrongEdit,"Modification d'entreprise par non-administrateur");
ok(await owner.from("mgmail_agenda_events")
  .update({status:"cancelled"}).eq("id",company),"Annulation par la direction");
const badReminder=await owner.from("mgmail_agenda_events")
  .insert({...event(ownerId,"personal",null,"Rappel invalide"),reminder_days:[-1,370]});
check(!!badReminder.error,"La base doit refuser les délais de rappel hors limites.");

const outsider=client(anon);
noRows(await outsider.from("mgmail_agenda_events")
  .select("id").eq("organization_id",org),"Isolation anonyme");
process.stdout.write("PASS MGMail agenda : agendas personnels privés, service, entreprise, permissions et rappels.\n");
