"use client";
import {formatDocumentAmount} from "@/lib/format-document-amount";
import {calculatePayrollAmounts} from "@/lib/payroll/calculate-payroll";
import {useState} from "react";

type Bracket={up_to:number|null;rate:number};
type Rule={id:string;name:string;effective_from:string;effective_to:string|null;status:string;cnaps_employee_rate:number;cnaps_employer_rate:number;health_employee_rate:number;health_employer_rate:number;fmfp_employer_rate:number;cnaps_monthly_ceiling:number|null;health_monthly_ceiling:number|null;irsa_health_deduction_rate:number;irsa_pension_deduction_rate:number;irsa_brackets:unknown;irsa_minimum:number|null;irsa_dependant_reduction:number;irsa_dependant_threshold:number;rounding_policy:string|null;legal_reference:string|null;smie_partner_name?:string|null;};
export function PayrollRulePreview({rules,currency,companyName,defaultSmie}:{rules:Rule[];currency:string;companyName:string;defaultSmie:string|null}){
 const [date,setDate]=useState(new Date().toISOString().slice(0,10));
 const [gross,setGross]=useState("1000000");
 const [dependants,setDependants]=useState("0");
 const [irsaDeductionAuthorized,setIrsaDeductionAuthorized]=useState(false);
 const [confirm,setConfirm]=useState(false);
 const applicable=rules.filter(r=>r.effective_from<=date&&(!r.effective_to||r.effective_to>=date)).sort((a,b)=>b.effective_from.localeCompare(a.effective_from))[0];
 const money=(v:number)=>formatDocumentAmount(v,{currency});
 const brut=Number(gross);
 const valid=gross.trim()!==""&&Number.isFinite(brut)&&brut>=0;
 const people=Number(dependants);
 const validDependants=dependants.trim()!==""&&Number.isInteger(people)&&people>=0&&people<=30;
 const configured=!!applicable&&applicable.status==="validated"&&applicable.cnaps_monthly_ceiling!==null&&applicable.health_monthly_ceiling!==null&&applicable.rounding_policy==="floor_100"&&Array.isArray(applicable.irsa_brackets)&&applicable.irsa_brackets.length>0;
 let baseCnaps=0,baseHealth=0,social=0,health=0,patronCnaps=0,patronHealth=0,patronFmfp=0,employer=0,taxable=0;
 let tax:number|null=null;
 let deductibleHealth=0,deductiblePension=0;
 let error="";
 if(configured&&valid&&validDependants&&applicable){
   try {
     const calculation=calculatePayrollAmounts({
       gross:brut,
       dependants:people,
       irsaDeductionAuthorized,
       rule:{
         cnaps_employee_rate:Number(applicable.cnaps_employee_rate),
         cnaps_employer_rate:Number(applicable.cnaps_employer_rate),
         health_employee_rate:Number(applicable.health_employee_rate),
         health_employer_rate:Number(applicable.health_employer_rate),
         fmfp_employer_rate:Number(applicable.fmfp_employer_rate),
         cnaps_monthly_ceiling:Number(applicable.cnaps_monthly_ceiling),
         health_monthly_ceiling:Number(applicable.health_monthly_ceiling),
         irsa_health_deduction_rate:Number(applicable.irsa_health_deduction_rate),irsa_pension_deduction_rate:Number(applicable.irsa_pension_deduction_rate),
         irsa_brackets:applicable.irsa_brackets as Bracket[],
         irsa_minimum:Number(applicable.irsa_minimum),
         irsa_dependant_reduction:Number(applicable.irsa_dependant_reduction),
         irsa_dependant_threshold:Number(applicable.irsa_dependant_threshold),
       },
     });
     baseCnaps=calculation.cnapsBase;
     baseHealth=calculation.healthBase;
     social=calculation.employeeSocial;
     health=calculation.employeeHealth;
     patronCnaps=calculation.employerSocial;
     patronHealth=calculation.employerHealth;
     patronFmfp=calculation.employerFmfp;
     employer=patronCnaps+patronHealth+patronFmfp;
     taxable=calculation.taxableBase;
     deductibleHealth=calculation.deductibleHealth;
     deductiblePension=calculation.deductiblePension;
     tax=calculation.incomeTax;
   } catch (cause) {
     error=cause instanceof Error?cause.message:"Calcul de paie invalide.";
   }
 }
 const fmt=(n:number)=>Number.isFinite(n)?money(n):"-";
 return <div className="card" style={{marginTop:18}}>
 <h2>Simulateur de paie</h2><p className="muted">Estimation basée sur le référentiel daté et les paramètres saisis. Sans avances, primes supplémentaires ni autres retenues. Aucun bulletin ni écriture n'est créé.</p>
 <div className="grid2">
 <div className="field"><label>Date de paie</label><input type="date" value={date} onChange={e=>setDate(e.target.value)}/></div>
 <div className="field"><label>Brut de simulation (Ar)</label><input type="number" min="0" value={gross} onChange={e=>setGross(e.target.value)}/></div>
 <div className="field"><label>Personnes à charge IRSA (simulation)</label><input type="number" min="0" max="30" step="1" value={dependants} onChange={e=>setDependants(e.target.value)}/></div>
 <div className="field"><label style={{display:"flex",alignItems:"center",gap:8}}><input type="checkbox" checked={irsaDeductionAuthorized} onChange={e=>setIrsaDeductionAuthorized(e.target.checked)} style={{width:"auto"}}/>Notification écrite DGI valide</label><small className="muted">Sans notification écrite couvrant la période, les cotisations santé et retraite restent retenues mais ne réduisent pas l'assiette IRSA.</small></div>
 </div>
 {!valid&&<p className="error">Saisissez un montant brut positif ou nul.</p>}
 {!validDependants&&<p className="error">Nombre de personnes à charge invalide.</p>}
 {!applicable?<p className="error">Aucun référentiel ne couvre cette date.</p>:<>
 <p><strong>{applicable.name}</strong> - statut : {applicable.status==="validated"?"Validé":applicable.status==="pending_review"?"À vérifier":"Brouillon / archivé"}</p>
 {!configured&&<p className="error">Référentiel non validé ou paramètres IRSA / plafonds incomplets : net indicatif indisponible.</p>}
 {valid&&<div className="grid2"><div>
 <p>Salaire brut : <strong>{fmt(brut)}</strong></p>
 <p>Assiette CNaPS : <strong>{fmt(baseCnaps)}</strong></p>
 <p>Retenue CNaPS salarié : <strong>{fmt(social)}</strong></p>
 <p>Assiette santé SMIE : <strong>{fmt(baseHealth)}</strong></p>
 <p>SMIE partenaire de {companyName} : <strong>{applicable.smie_partner_name||defaultSmie||"Non renseignée"}</strong></p><p>{applicable.smie_partner_name||defaultSmie||"SMIE"} salarié : <strong>{fmt(health)}</strong></p>
 <p>Déduction santé IRSA : <strong>{fmt(deductibleHealth)}</strong></p>
 <p>Déduction retraite IRSA : <strong>{fmt(deductiblePension)}</strong></p>
 <p>Base imposable IRSA arrondie : <strong>{configured?fmt(taxable):"Non calculée"}</strong></p>
 <p>IRSA estimé : <strong>{tax!==null?fmt(tax):"Non calculé"}</strong></p>
 {error&&<p className="error">{error}</p>}
 <p><strong>Salaire net estimé : {tax!==null?fmt(brut-social-health-tax):"Indisponible"}</strong></p>
 </div><div>
 <p>CNaPS employeur : <strong>{fmt(patronCnaps)}</strong></p>
 <p>{applicable.smie_partner_name||defaultSmie||"SMIE"} employeur : <strong>{fmt(patronHealth)}</strong></p>
 <p>FMFP employeur : <strong>{fmt(patronFmfp)}</strong></p>
 <p>Total charges patronales : <strong>{fmt(employer)}</strong></p>
 <p><strong>Coût total employeur : {fmt(brut+employer)}</strong></p>
 <p className="muted">Les charges patronales ne sont pas déduites du net du salarié. IRSA et net restent des estimations : vérifier l'assiette fiscale, les réductions et la situation individuelle.</p>
 </div></div>}
 </>}
 <label style={{display:"flex",alignItems:"center",gap:8,fontSize:12}}><input type="checkbox" checked={confirm} onChange={e=>setConfirm(e.target.checked)} style={{width:"auto"}}/>Je comprends que cette prévisualisation n'est pas un bulletin payable.</label>
 <p className="muted">{confirm?"Prévisualisation uniquement. Aucune écriture ni bulletin n'a été créé.":"Cette simulation ne valide aucun bulletin ni paiement."}</p>
 </div>;
}
