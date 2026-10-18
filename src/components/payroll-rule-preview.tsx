"use client";
import {useState} from "react";
type Rule={id:string;name:string;effective_from:string;effective_to:string|null;status:string;cnaps_employee_rate:number;cnaps_employer_rate:number;health_employee_rate:number;health_employer_rate:number;fmfp_employer_rate:number;cnaps_monthly_ceiling:number|null;health_monthly_ceiling:number|null;irsa_brackets:unknown;legal_reference:string|null};
export function PayrollRulePreview({rules,currency}:{rules:Rule[];currency:string}){
 const [date,setDate]=useState(new Date().toISOString().slice(0,10));
 const [gross,setGross]=useState("1000000");
 const [confirm,setConfirm]=useState(false);
 const applicable=rules.filter(r=>r.effective_from<=date&&(!r.effective_to||r.effective_to>=date)).sort((a,b)=>b.effective_from.localeCompare(a.effective_from))[0];
 const money=(v:number)=>new Intl.NumberFormat("fr-FR",{style:"currency",currency}).format(v);
 const brut=Number(gross);
 const valid=Number.isFinite(brut)&&brut>=0;
 const baseCnaps=applicable?Math.min(brut,applicable.cnaps_monthly_ceiling??brut):0;
 const baseHealth=applicable?Math.min(brut,applicable.health_monthly_ceiling??brut):0;
 const social=applicable?baseCnaps*Number(applicable.cnaps_employee_rate):0;
 const health=applicable?baseHealth*Number(applicable.health_employee_rate):0;
 const employer=applicable?baseCnaps*Number(applicable.cnaps_employer_rate)+baseHealth*Number(applicable.health_employer_rate)+brut*Number(applicable.fmfp_employer_rate):0;
 const fmt=(n:number)=>Number.isFinite(n)?money(n):"-";
 return <div className="card" style={{marginTop:18}}>
 <h2>Prévisualisation des paramètres</h2><p className="muted">Simulation informative uniquement : ni IRSA ni net légal ne sont certifiés tant que le barème, les arrondis et les assiettes ne sont pas vérifiés.</p>
 <div className="grid2"><div className="field"><label>Date de paie</label><input type="date" value={date} onChange={e=>setDate(e.target.value)}/></div><div className="field"><label>Brut de simulation</label><input type="number" min="0" value={gross} onChange={e=>setGross(e.target.value)}/></div></div>
 {!applicable?<p className="error">Aucun jeu de règles ne couvre cette date. Aucun calcul réglementaire possible.</p>:<><p><strong>{applicable.name}</strong> - statut : {applicable.status==="validated"?"Validé":applicable.status==="pending_review"?"À vérifier":"Brouillon / archivé"}</p>
 {applicable.status!=="validated"&&<p className="error">Paramètres non validés : calcul définitif et intégration automatique aux bulletins interdits.</p>}
 {valid&&<div className="grid2"><div><p>Assiette CNaPS : <strong>{fmt(baseCnaps)}</strong></p><p>Retenue CNaPS indicative : <strong>{fmt(social)}</strong></p><p>Cotisation santé indicative : <strong>{fmt(health)}</strong></p></div><div><p>Charges patronales indicatives : <strong>{fmt(employer)}</strong></p><p>Brut avant IRSA et autres retenues : <strong>{fmt(brut)}</strong></p><p>IRSA : <strong>Non calculé - règles à valider</strong></p></div></div>}
 </>}
 <label style={{display:"flex",alignItems:"center",gap:8,fontSize:12}}><input type="checkbox" checked={confirm} onChange={e=>setConfirm(e.target.checked)} style={{width:"auto"}}/>Je comprends que cette prévisualisation n'est pas un bulletin payable.</label>
 <p className="muted">{confirm?"Prévisualisation uniquement. Aucune écriture ni bulletin n'a été créé.":"Validation nécessaire avant tout usage réglementaire."}</p>
 </div>
}
