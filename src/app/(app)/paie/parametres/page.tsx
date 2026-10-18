import Link from "next/link";
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
export default async function PayrollSettings(){
 const ctx=await requireOrganization();await requirePermission(ctx,"payroll.view");
 const [{data:rules,error},{data:org}]=await Promise.all([
 ctx.supabase.from("payroll_rule_sets").select("id,name,effective_from,effective_to,status,cnaps_employee_rate,cnaps_employer_rate,health_employee_rate,health_employer_rate,fmfp_employer_rate,cnaps_monthly_ceiling,health_monthly_ceiling,irsa_brackets,legal_reference").eq("organization_id",ctx.organizationId).order("effective_from",{ascending:false}),
 ctx.supabase.from("organizations").select("currency").eq("id",ctx.organizationId).single()
 ]);
 if(error)throw new Error(error.message);
 return <><div className="pageHead"><div><p className="eyebrow">Personnel & Paie</p><h1>Paramètres de paie - Madagascar</h1><p>Règles datées par organisation, contrôle de conformité et prévisualisation non comptable.</p></div><Link className="button" href="/paie">Retour aux bulletins</Link></div>
 <div className="card"><h2>Nouveau jeu de paramètres - à vérifier</h2><p className="muted">Saisis uniquement des taux contrôlés auprès des organismes et du Code général des impôts. Aucune valeur réglementaire n'est préremplie. Une configuration enregistrée ne devient jamais automatiquement validée.</p>
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
 </div>
 <div className="section card"><h2>Historique des règles</h2>{!rules?.length?<p className="muted">Aucun paramètre enregistré. Les bulletins existants restent inchangés.</p>:<div className="tableWrap"><table><thead><tr><th>Version</th><th>Début</th><th>Fin</th><th>Statut</th><th>Référence</th></tr></thead><tbody>{rules.map((r:any)=><tr key={r.id}><td>{r.name}</td><td>{r.effective_from}</td><td>{r.effective_to||"Sans date de fin"}</td><td><span className="badge">{r.status==="pending_review"?"À vérifier":r.status}</span></td><td>{r.legal_reference||"Non renseignée"}</td></tr>)}</tbody></table></div>}</div>
 <PayrollRulePreview rules={(rules||[]) as any[]} currency={org?.currency||"MGA"}/>
 <div className="card section"><h2>IRSA et validation réglementaire</h2><p className="muted">Le barème fiscal progressif, les réductions, les minimums, les assiettes et les arrondis requièrent une procédure de contrôle distincte. Ils ne sont pas activés par ce formulaire. Aucun paramètre non vérifié ne peut déclencher automatiquement un bulletin fiscal ou un paiement.</p></div>
 </>;
}
