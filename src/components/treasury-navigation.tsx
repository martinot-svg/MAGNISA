"use client";
import {useState, type ReactNode} from "react";
type Section="dashboard"|"accounts"|"movements"|"transfers"|"reconciliation";
const labels:Record<Section,string>={dashboard:"Tableau de bord",accounts:"Comptes",movements:"Mouvements",transfers:"Transferts",reconciliation:"Rapprochement"};
export function TreasuryNavigation({dashboard,accounts,movements,transfers,reconciliation}:{dashboard:ReactNode;accounts:ReactNode;movements:ReactNode;transfers:ReactNode;reconciliation:ReactNode}){
 const [active,setActive]=useState<Section>("dashboard");
 const items:Section[]=["dashboard","accounts","movements","transfers","reconciliation"];
 return <div>
  <nav aria-label="Navigation Trésorerie" style={{display:"flex",flexWrap:"wrap",gap:10,marginBottom:22}}>
   {items.map(item=><button key={item} type="button" className={active===item?"button primary":"button"} aria-current={active===item?"page":undefined} onClick={()=>setActive(item)}>{labels[item]}</button>)}
  </nav>
  <div aria-live="polite">
   {active==="dashboard"?dashboard:active==="accounts"?accounts:active==="movements"?movements:active==="transfers"?transfers:reconciliation}
  </div>
 </div>;
}
