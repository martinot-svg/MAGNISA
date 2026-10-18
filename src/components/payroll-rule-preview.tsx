import {formatDocumentAmount} from "@/lib/format-document-amount";
"use client";
import {useState} from "react";

type Bracket={up_to:number|null;rate:number};
type Rule={id:string;name:string;effective_from:string;effective_to:string|null;status:string;cnaps_employee_rate:number;cnaps_employer_rate:number;health_employee_rate:number;health_employer_rate:number;fmfp_employer_rate:number;cnaps_monthly_ceiling:number|null;health_monthly_ceiling:number|null;irsa_brackets:unknown;irsa_minimum:number|null;rounding_policy:string|null;legal_reference:string|null;smie_partner_name?:string|null;};
const round=(n:number)=>Math.round(n*100)/100;
export function PayrollRulePreview({rules,currency,companyName,defaultSmie}:{rules:Rule[];currency:string;companyName:string;defaultSmie:string|null}){
 const [date,setDate]=useState(new Date().toISOString().slice(0,10));
 const [gross,setGross]=useState("1000000");
 const [dependants,setDependants]=useState("0");
 const [confirm,setConfirm]=useState(false);
 const applicable=rules.filter(r=>r.effective_from<=date&&(!r.effective_to||r.effective_to>=date)).sort((a,b)=>b.effective_from.localeCompare(a.effective_from))[0];
 const money=(v:number)=>formatDocumentAmount(v,{currency});
 const brut=Number(gross);
 const valid=gross.trim()!==""&&Number.isFinite(brut)&&brut>=0;
 const people=Number(dependants);
 const validDependants=dependants.trim()!==""&&Number.isInteger(people)&&people>=0&&people<=30;
 const configured=!!applicable&&applicable.status==="validated"&&applicable.cnaps_monthly_ceiling!==null&&applicable.health_monthly_ceiling!==null&&applicable.rounding_policy==="floor_100"&&Array.isArray(applicable.irsa_brackets)&&applicable.irsa_brackets.length>0;
 const baseCnaps=valid&&applicable?Math.min(brut,Number(applicable.cnaps_monthly_ceiling??brut)):0;
 const baseHealth=valid&&applicable?Math.min(brut,Number(applicable.health_monthly_ceiling??brut)):0;
 const social=applicable?round(baseCnaps*Number(applicable.cnaps_employee_rate)):0;
 const health=applicable?round(baseHealth*Number(applicable.health_employee_rate)):0;
 const patronCnaps=applicable?round(baseCnaps*Number(applicable.cnaps_employer_rate)):0;
 const patronHealth=applicable?round(baseHealth*Number(applicable.health_employer_rate)):0;
 const patronFmfp=applicable?round(brut*Number(applicable.fmfp_employer_rate)):0;
 const employer=patronCnaps+patronHealth+patronFmfp;
 const taxable=Math.floor(Math.max(0,brut-social-health)/100)*100;
 let tax:number|null=null;
 let error="";
 if(configured&&valid&&validDependants&&applicable){
   const brackets=applicable.irsa_brackets as Bracket[];
   let accumulated=0,prev=0,covered=false;
   for(const b of brackets){
     const cap=b.up_to===null?Infinity:Number(b.up_to),rate=Number(b.rate);
     if(!Number.isFinite(rate)||rate<0||rate>1||!(cap>prev)){error="Tranches IRSA incohérentes.";break;}
     accumulated+=Math.max(0,Math.min(taxable,cap)-prev)*rate;
     prev=cap;
     if(taxable<=cap){covered=true;break;}
   }
   if(!error&&!covered)error="Barème IRSA incomplet.";
   const minimum=Number(applicable.irsa_minimum);
   if(!Number.isFinite(minimum)||minimum<0)error="Minimum IRSA invalide.";
   if(!error){
     accumulated=Math.max(minimum,round(accumulated));
     if(taxable>350000&&people>0)accumulated=Math.max(minimum,accumulated-2000*people);
     tax=accumulated;
   }
 }
 const fmt=(n:number)=>Number.isFinite(n)?money(n):"-";
 return <div className="card" style={{marginTop:18}}>
 <h2>Prévisualisation des paramètres</h2><p className="muted">Estimation basée sur le référentiel daté et les paramètres saisis. Sans avances, primes supplémentaires ni autres retenues. Aucun bulletin ni écriture n'est créé.</p>
 <div className="grid2">
 <div className="field"><label>Date de paie</label><input type="date" value={date} onChange={e=>setDate(e.target.value)}/></div>
 <div className="field"><label>Brut de simulation (Ar)</label><input type="number" min="0" value={gross} onChange={e=>setGross(e.target.value)}/></div>
 <div className="field"><label>Personnes à charge IRSA (simulation)</label><input type="number" min="0" max="30" step="1" value={dependants} onChange={e=>setDependants(e.target.value)}/></div>
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
