"use client";
import {useMemo,useState} from "react";

type Employee={id:string;name:string;baseSalary:number};
export function PayrollGrossPreview({employees,currency}:{employees:Employee[];currency:string}){
 const [employeeId,setEmployeeId]=useState(employees[0]?.id||"");
 const [bonuses,setBonuses]=useState("0");
 const [overtime,setOvertime]=useState("0");
 const [other,setOther]=useState("0");
 const employee=employees.find(e=>e.id===employeeId);
 const extras=[bonuses,overtime,other].map(v=>v.trim()===""?0:Number(v));
 const valid=!!employee&&[employee.baseSalary,...extras].every(v=>Number.isFinite(v)&&v>=0);
 const gross=useMemo(()=>valid?employee!.baseSalary+extras.reduce((a,b)=>a+b,0):null,[valid,employee,bonuses,overtime,other]);
 return <section className="card section" aria-label="Estimation du salaire brut">
  <h2>Préparer le salaire brut</h2>
  <p className="muted">Calcul immédiat à partir des salaires enregistrés. Aucune règle sociale ou fiscale non confirmée n'est appliquée.</p>
  {!employees.length?<p>Aucun salarié actif. Ajoutez d'abord un salarié.</p>:<div className="form">
   <div className="field"><label htmlFor="gross-employee">Salarié</label><select id="gross-employee" value={employeeId} onChange={e=>setEmployeeId(e.target.value)}>{employees.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></div>
   <div className="grid2">
    {([{label:"Primes",value:bonuses,set:setBonuses,id:"gross-bonuses"},{label:"Heures supplémentaires",value:overtime,set:setOvertime,id:"gross-overtime"},{label:"Autres gains",value:other,set:setOther,id:"gross-other"}]).map(f=><div className="field" key={f.id}><label htmlFor={f.id}>{f.label}</label><input id={f.id} type="number" min="0" step="0.01" value={f.value} onChange={e=>f.set(e.target.value)}/></div>)}
   </div>
   {gross===null?<p role="alert">Renseignez des montants valides et positifs ou nuls.</p>:<p aria-live="polite"><strong>Salaire brut estimé : {new Intl.NumberFormat("fr-FR",{maximumFractionDigits:2}).format(gross)} {currency}</strong></p>}
   <p className="muted">Simulation non enregistrée : ne constitue ni un bulletin, ni un salaire net, ni une validation ou une écriture comptable. Les éléments variables doivent être ressaisis dans le calcul définitif.</p>
  </div>}
 </section>;
}
