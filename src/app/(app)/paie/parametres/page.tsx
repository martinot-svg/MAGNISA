import Link from "next/link";
import {redirect} from "next/navigation";
import {revalidatePath} from "next/cache";
import {requireOrganization} from "@/lib/current-org";
import {assertPermission,requirePermission} from "@/lib/permissions";
import {PayrollRulePreview} from "@/components/payroll-rule-preview";

async function saveRule(fd:FormData){
 "use server";
 const ctx=await requireOrganization();await assertPermission(ctx,"payroll.manage");
 const name=String(fd.get("name")||"").trim();
 const from=String(fd.get("effective_from")||"");
 const until=String(fd.get("effective_to")||"")||null;
 if(!name||!/^\d{4}-\d{2}-\d{2}$/.test(from)||until&&(!/^\d{4}-\d{2}-\d{2}$/.test(until)||until<from))throw new Error("Nom ou période invalide.");
 const rates=["cnaps_employee_rate","cnaps_employer_rate","health_employee_rate","health_employer_rate","fmfp_employer_rate"] as const;
 const data:Record<string,string|number|null>={name,effective_from:from,effective_to:until,status:"pending_review",legal_reference:String(fd.get("legal_reference")||"").trim()||null,rounding_policy:"unverified"};
 for(const key of rates){const raw=Number(fd.get(key));if(!Number.isFinite(raw)||raw<0||raw>100)throw new Error("Taux invalide : "+key);data[key]=raw/100;}
 for(const key of ["cnaps_monthly_ceiling","health_monthly_ceiling"]){const raw=String(fd.get(key)||"").trim();const n=Number(raw);if(raw!==""&&(!Number.isFinite(n)||n<0))throw new Error("Plafond invalide.");data[key]=raw===""?null:n;}
 const {error}=await ctx.supabase.from("payroll_rule_sets").insert({...data,organization_id:ctx.organizationId});
 if(error)throw new Error(error.message);
 revalidatePath("/paie/parametres");
}

async function executeRuleAction(fd:FormData){
 "use server";
 const ctx=await requireOrganization();await assertPermission(ctx,"payroll.manage");
 const id=String(fd.get("id")||""),action=String(fd.get("operation")||"");
 const {data:current,error:readError}=await ctx.supabase.from("payroll_rule_sets").select("*").eq("organization_id",ctx.organizationId).eq("id",id).single();
 if(readError||!current)throw new Error("Version introuvable.");
 if(action==="activate"){
  const {error}=await ctx.supabase.rpc("activate_payroll_rule",{p_org:ctx.organizationId,p_rule:id});
  if(error)throw new Error(error.message);
 }else if(action==="delete"){
  if(!["draft","pending_review"].includes(current.status))throw new Error("Une version validée ou archivée ne peut pas être supprimée.");
  const {error}=await ctx.supabase.from("payroll_rule_sets").delete().eq("organization_id",ctx.organizationId).eq("id",id).in("status",["draft","pending_review"]);
  if(error)throw new Error(error.message);
 }else if(action==="review"){
  if(!["draft","pending_review"].includes(current.status))throw new Error("Version non modifiable.");
  const {error}=await ctx.supabase.from("payroll_rule_sets").update({status:"pending_review",updated_at:new Date().toISOString()}).eq("organization_id",ctx.organizationId).eq("id",id);
  if(error)throw new Error(error.message);
 }else if(action==="edit"){
  if(!["draft","pending_review"].includes(current.status))throw new Error("Seuls les brouillons et paramètres à vérifier sont modifiables.");
  const name=String(fd.get("name")||"").trim(),date=String(fd.get("effective_from")||""),end=String(fd.get("effective_to")||"")||null,reference=String(fd.get("legal_reference")||"").trim();
  if(!name||!/^\d{4}-\d{2}-\d{2}$/.test(date)||end&&end<date)throw new Error("Nom ou dates invalides.");
  const patch:Record<string,unknown>={name,effective_from:date,effective_to:end,legal_reference:reference||null,status:"pending_review",updated_at:new Date().toISOString()};
  const rateKeys=["cnaps_employee_rate","cnaps_employer_rate","health_employee_rate","health_employer_rate","fmfp_employer_rate"];
  for(const key of rateKeys){const raw=String(fd.get(key)??"").trim();if(raw==="")throw new Error("Taux obligatoire pour la validation : "+key);const val=Number(raw);if(!Number.isFinite(val)||val<0||val>100)throw new Error("Taux invalide : "+key);patch[key]=val/100;}
  for(const key of ["cnaps_monthly_ceiling","health_monthly_ceiling"]){const raw=String(fd.get(key)??"").trim();const val=Number(raw);if(raw!==""&&(!Number.isFinite(val)||val<=0))throw new Error("Plafond invalide : "+key);patch[key]=raw===""?null:val;}
  const minimumRaw=String(fd.get("irsa_minimum")??"").trim();
  if(minimumRaw!==""){const min=Number(minimumRaw);if(!Number.isFinite(min)||min<0)throw new Error("Minimum IRSA invalide.");patch.irsa_minimum=min;}
  const bracketsRaw=String(fd.get("irsa_brackets")??"").trim();
  if(bracketsRaw!==""){
    let parsed:unknown;
    try{parsed=JSON.parse(bracketsRaw);}catch{throw new Error("Le barème IRSA doit être du JSON valide.");}
    if(!Array.isArray(parsed)||!parsed.length)throw new Error("Le barème doit comporter des tranches.");
    let prior=0;let lastOpen=false;
    for(let i=0;i<parsed.length;i++){const b=parsed[i];if(!b||typeof b!=="object")throw new Error("Tranche IRSA invalide.");
      if(typeof b.rate!=="number"||!Number.isFinite(b.rate)||b.rate<0||b.rate>1)throw new Error("Taux de tranche IRSA invalide.");
      if(b.up_to===null){if(i!==parsed.length-1)throw new Error("La tranche supérieure ouverte doit être la dernière.");lastOpen=true;}
      else if(typeof b.up_to!=="number"||!Number.isFinite(b.up_to)||b.up_to<=prior)throw new Error("Bornes des tranches IRSA invalides.");
      else prior=b.up_to;
    }
    if(!lastOpen)throw new Error("La dernière tranche IRSA doit être ouverte.");
    patch.irsa_brackets=parsed;
  }
  const rounding=String(fd.get("rounding_policy")??"unverified");
  if(!["floor_100","unverified"].includes(rounding))throw new Error("Règle d'arrondi inconnue.");
  patch.rounding_policy=rounding;
  const {error}=await ctx.supabase.from("payroll_rule_sets").update(patch).eq("organization_id",ctx.organizationId).eq("id",id);
  if(error)throw new Error(error.message);
 }else throw new Error("Opération non reconnue.");
 revalidatePath("/paie/parametres");
}

async function ruleAction(fd:FormData){
 "use server";
 const operation=String(fd.get("operation")||"");
 let outcome:"success"|"error"="success";
 let message="Paramètres mis à jour.";
 try {
   await executeRuleAction(fd);
   message=operation==="edit"?"Modifications enregistrées. Le référentiel reste à vérifier.":operation==="review"?"Référentiel maintenu à vérifier.":operation==="delete"?"Référentiel non validé supprimé.":operation==="activate"?"Référentiel validé après contrôle des conditions.":"Opération effectuée.";
 } catch(error) {
   outcome="error";
   message=error instanceof Error?error.message:"Impossible de traiter la demande.";
 }
 const params=new URLSearchParams({result:outcome,message});
 redirect("/paie/parametres?"+params.toString());
}

export default async function PayrollSettings({searchParams}:{searchParams:Promise<{result?:string;message?:string}>}){
 const ctx=await requireOrganization();await requirePermission(ctx,"payroll.view");
 const [{data:rules,error},{data:org}]=await Promise.all([
 ctx.supabase.from("payroll_rule_sets").select("id,name,effective_from,effective_to,status,cnaps_employee_rate,cnaps_employer_rate,health_employee_rate,health_employer_rate,fmfp_employer_rate,cnaps_monthly_ceiling,health_monthly_ceiling,irsa_brackets,irsa_minimum,rounding_policy,legal_reference").eq("organization_id",ctx.organizationId).order("effective_from",{ascending:false}),
 ctx.supabase.from("organizations").select("currency").eq("id",ctx.organizationId).single()
 ]);
 if(error)throw new Error(error.message);
 const notice=await searchParams;
 return <><div className="pageHead"><div><p className="eyebrow">Personnel & Paie</p><h1>Paramètres de paie - Madagascar</h1><p>Règles datées par organisation, contrôle de conformité et prévisualisation non comptable.</p></div><Link className="button" href="/paie">Retour aux bulletins</Link></div>
 {notice.result && notice.message && <div role="status" aria-live="polite" className="card section" style={{borderLeft:notice.result==="error"?"4px solid #b45309":"4px solid #15803d"}}><strong>{notice.result==="error"?"Opération non effectuée":"Opération effectuée"}</strong><p>{notice.message.slice(0,450)}</p></div>}
 <div className="card"><details><summary style={{cursor:"pointer",fontWeight:600}}>Créer un référentiel réglementaire</summary><h2>Nouveau jeu de paramètres - à vérifier</h2><p className="muted">Saisis uniquement des taux contrôlés auprès des organismes et du Code général des impôts. Aucune valeur réglementaire n'est préremplie. Une configuration enregistrée ne devient jamais automatiquement validée. Le bouton « Maintenir à vérifier » ne constitue pas une vérification juridique.</p>
 <form action={saveRule} className="form"><div className="grid2">
 <div className="field"><label>Nom / version</label><input name="name" placeholder="Ex. Référentiel 2026 à vérifier" required/></div>
 <div className="field"><label>Référence officielle contrôlée</label><input name="legal_reference" placeholder="Texte, article et date de publication"/></div>
 <div className="field"><label>Applicable du</label><input name="effective_from" type="date" required/></div>
 <div className="field"><label>Jusqu'au (facultatif)</label><input name="effective_to" type="date"/></div>
 <div className="field"><label>CNaPS salarié (%)</label><input name="cnaps_employee_rate" type="number" min="0" max="100" step="0.0001" required/></div>
 <div className="field"><label>CNaPS employeur (%)</label><input name="cnaps_employer_rate" type="number" min="0" max="100" step="0.0001" required/></div>
 <div className="field"><label>Santé salarié (%)</label><input name="health_employee_rate" type="number" min="0" max="100" step="0.0001" required/></div>
 <div className="field"><label>Santé employeur (%)</label><input name="health_employer_rate" type="number" min="0" max="100" step="0.0001" required/></div>
 <div className="field"><label>FMFP employeur (%)</label><input name="fmfp_employer_rate" type="number" min="0" max="100" step="0.0001" required/></div>
 <div className="field"><label>Plafond CNaPS mensuel (Ar)</label><input name="cnaps_monthly_ceiling" type="number" min="0" step="0.01" placeholder="À confirmer"/></div>
 <div className="field"><label>Plafond organisme santé (Ar)</label><input name="health_monthly_ceiling" type="number" min="0" step="0.01" placeholder="À confirmer"/></div>
 </div><button className="button primary">Enregistrer pour vérification</button></form>
 </details></div>
 <div className="section card"><h2>Historique des règles</h2>{!rules?.length?<p className="muted">Aucun paramètre enregistré.</p>:<div className="tableWrap"><table><thead><tr><th>Version</th><th>Début</th><th>Fin</th><th>Statut</th><th>Référence</th><th>Actions</th></tr></thead><tbody>{rules.map((r:any)=><tr key={r.id}><td>{r.name}</td><td>{r.effective_from}</td><td>{r.effective_to||"Sans date de fin"}</td><td><span className="badge">{r.status==="pending_review"?"À vérifier":r.status}</span></td><td>{r.legal_reference||"Non renseignée"}</td><td><details><summary style={{cursor:"pointer"}}>Consulter / Actions</summary><p className="muted">CNaPS salarié : {Number(r.cnaps_employee_rate)*100}% - employeur : {Number(r.cnaps_employer_rate)*100}%</p><p className="muted">Santé salarié : {Number(r.health_employee_rate)*100}% - employeur : {Number(r.health_employer_rate)*100}% - FMFP : {Number(r.fmfp_employer_rate)*100}%</p><p className="muted">Plafonds : CNaPS {r.cnaps_monthly_ceiling??"Non confirmé"} Ar - Santé {r.health_monthly_ceiling??"Non confirmé"} Ar</p>{["draft","pending_review"].includes(r.status)&&<>
<form action={ruleAction} className="form" style={{minWidth:260}}><input type="hidden" name="id" value={r.id}/><input type="hidden" name="operation" value="edit"/><div className="field"><label>Version</label><input name="name" defaultValue={r.name} required/></div><div className="field"><label>Début</label><input type="date" name="effective_from" defaultValue={r.effective_from} required/></div><div className="field"><label>Fin</label><input type="date" name="effective_to" defaultValue={r.effective_to||""}/></div><div className="field"><label>Référence</label><textarea name="legal_reference" defaultValue={r.legal_reference||""}/></div><div className="grid2">
{(["cnaps_employee_rate","cnaps_employer_rate","health_employee_rate","health_employer_rate","fmfp_employer_rate"] as const).map(key=><div className="field" key={key}><label>{key.replaceAll("_"," ")} (%)</label><input type="number" min="0" max="100" step="0.0001" name={key} defaultValue={Number(r[key])*100} required/></div>)}
<div className="field"><label>Plafond CNaPS (Ar)</label><input name="cnaps_monthly_ceiling" type="number" step="0.01" min="0.01" defaultValue={r.cnaps_monthly_ceiling??""}/></div>
<div className="field"><label>Plafond organisme sanitaire (Ar)</label><input name="health_monthly_ceiling" type="number" step="0.01" min="0.01" defaultValue={r.health_monthly_ceiling??""}/></div>
<div className="field"><label>Minimum IRSA (Ar)</label><input name="irsa_minimum" type="number" min="0" step="0.01" defaultValue={r.irsa_minimum??0}/></div>
<div className="field"><label>Arrondi de l'assiette IRSA</label><select name="rounding_policy" defaultValue={r.rounding_policy||"unverified"}><option value="unverified">Non vérifié</option><option value="floor_100">Centaine d'ariary inférieure - vérifié</option></select></div>
</div>
<div className="field"><label>Tranches IRSA - JSON (bornes Ar, taux décimaux)</label><textarea rows={7} spellCheck={false} name="irsa_brackets" defaultValue={JSON.stringify(r.irsa_brackets??[],null,2)} placeholder={'[{"up_to":350000,"rate":0},{"up_to":null,"rate":0.2}]'}/><small>Renseigner uniquement un barème contrôlé. La dernière tranche doit utiliser up_to:null. Aucun chiffre d'exemple n'est activé.</small></div>
<button className="button">Corriger les paramètres</button></form>
<div className="actions" style={{marginTop:10}}><form action={ruleAction}><input type="hidden" name="id" value={r.id}/><input type="hidden" name="operation" value="review"/><button className="button">Maintenir à vérifier</button></form><form action={ruleAction}><input type="hidden" name="id" value={r.id}/><input type="hidden" name="operation" value="activate"/><button className="button primary">Activer - après contrôle des textes</button></form><form action={ruleAction}><input type="hidden" name="id" value={r.id}/><input type="hidden" name="operation" value="delete"/><button className="button">Supprimer</button></form></div></>}</details></td></tr>)}</tbody></table></div>}</div>
 <PayrollRulePreview rules={(rules||[]) as any[]} currency={org?.currency||"MGA"}/>
 <div className="card section"><h2>Sources officielles et contrôles - Madagascar 2026</h2><p>Références documentées auprès des organismes officiels. La présence d'une source ne vaut pas certification complète d'un calcul de paie.</p><div className="tableWrap"><table><thead><tr><th>Organisme</th><th>Élément contrôlé</th><th>État</th><th>Source officielle</th></tr></thead><tbody><tr><td>CNaPS</td><td>Arrêté n°5410/99 et taux sociaux</td><td>Référence identifiée</td><td><a href="https://cnlegis.gov.mg/page_acces_pdf/dnWfpUcmX5gqT" target="_blank" rel="noreferrer">Texte réglementaire</a></td></tr><tr><td>CNaPS</td><td>2026 (régime général) : tableau daté au 01/03/2026 à 2 400 000 Ar ; actualité du 31/07/2026 à 2 101 440 Ar, contradictoire</td><td>Écart de publication - ne pas appliquer sans confirmer régime et période</td><td><a href="https://www.cnaps.mg/historique-sme" target="_blank" rel="noreferrer">Historique SME</a> / <a href="https://www.cnaps.mg/actualites/102" target="_blank" rel="noreferrer">Actualité du 31 juillet 2026</a></td></tr><tr><td>FMFP</td><td>1 % patronal de la masse salariale brute plafonnée, applicable depuis le 01/01/2019</td><td>Documenté - comptabilisation automatique à compléter</td><td><a href="https://www.fmfp.mg/fondement-legal/" target="_blank" rel="noreferrer">Fondement légal</a></td></tr><tr><td>Santé</td><td>Décret n°2003-1162 et organisme médical applicable</td><td>Assiette : ensemble des salaires et accessoires (art. 25) ; plafond éventuel et organisme à confirmer</td><td><a href="https://cnlegis.gov.mg/page_acces_pdf/dnWisR33gqT" target="_blank" rel="noreferrer">Décret médecine d'entreprise</a></td></tr><tr><td>IRSA</td><td>Code des impôts 2026, barème, assiette, réductions et arrondis</td><td>Réduction de 2 000 Ar/personne à charge (art. 01.03.19) à traiter ; cas particuliers non automatisés</td><td><a href="https://www.impots.mg/explorer?path=%2Flegislation%2FCodes+et+Manuels" target="_blank" rel="noreferrer">DGI - Code 2026</a></td></tr></tbody></table></div><p className="muted">Ne renseigne pas un plafond incertain pour contourner les contrôles. Les versions enregistrées restent non validées jusqu'à la résolution des points réglementaires.</p></div>
 <div className="card section"><h2>IRSA et validation réglementaire</h2><p className="muted">Le barème fiscal progressif, les réductions, les minimums, les assiettes et les arrondis requièrent une procédure de contrôle distincte. Ils ne sont pas activés par ce formulaire. Aucun paramètre non vérifié ne peut déclencher automatiquement un bulletin fiscal ou un paiement.</p></div>
 </>;
}
