"use client";
import {useState} from "react";
type Props={active:number;total:number;inflows:number;outflows:number};
export function TreasuryDashboardChart({active,total,inflows,outflows}:Props){
 const [mode,setMode]=useState<"bar"|"donut"|"kpi">("bar");
 const values=[{name:"Comptes actifs",value:active},{name:"Comptes de trésorerie",value:total},{name:"Entrées enregistrées",value:inflows},{name:"Sorties enregistrées",value:outflows}];
 const max=Math.max(1,...values.map(v=>v.value));
 const inactive=Math.max(0,total-active);
 const ratio=total>0?Math.max(0,Math.min(100,active/total*100)):0;
 return <section className="card" aria-label="Graphique des indicateurs de trésorerie">
  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12,marginBottom:16}}>
   <h3 style={{margin:0}}>Indicateurs de trésorerie</h3>
   <div className="field" style={{margin:0}}>
    <label htmlFor="treasury-chart-choice">Type de graphique</label>
    <select id="treasury-chart-choice" value={mode} onChange={e=>setMode(e.target.value as "bar"|"donut"|"kpi")}>
     <option value="bar">Histogramme</option><option value="donut">Anneau</option><option value="kpi">Indicateurs KPI</option>
    </select>
   </div>
  </div>
  {mode==="kpi"?<div className="grid2" aria-label="Indicateurs KPI de trésorerie">{values.map(v=><div key={v.name} className="card" style={{padding:16}}><div className="muted">{v.name}</div><div className="metric">{v.value}</div></div>)}</div>:mode==="bar"?<div role="img" aria-label={values.map(v=>v.name+": "+v.value).join(", ")} style={{display:"grid",gap:14}}>
   {values.map(v=><div key={v.name} style={{display:"grid",gridTemplateColumns:"minmax(135px,1fr) minmax(90px,2fr) 50px",alignItems:"center",gap:12}}>
    <span>{v.name}</span>
    <div style={{height:22,background:"var(--surface-2, #e5e7eb)",borderRadius:6,overflow:"hidden"}}>
     <div style={{height:"100%",width:`${v.value/max*100}%`,background:"var(--primary, #2563eb)",borderRadius:6}}/>
    </div><strong style={{textAlign:"right"}}>{v.value}</strong>
   </div>)}
  </div>:<div style={{display:"flex",gap:22,flexWrap:"wrap",alignItems:"center"}}>
   <div role="img" aria-label={total===0?"Aucun compte":`${active} comptes actifs et ${inactive} inactifs sur ${total}`} style={{width:170,height:170,borderRadius:"50%",background:total===0?"#e5e7eb":`conic-gradient(#2563eb 0% ${ratio}%, #cbd5e1 ${ratio}% 100%)`,display:"grid",placeItems:"center",flexShrink:0}}>
    <div style={{width:115,height:115,borderRadius:"50%",background:"var(--background, white)",display:"flex",flexDirection:"column",justifyContent:"center",alignItems:"center",color:"var(--foreground, #111827)"}}>
     <strong style={{fontSize:25}}>{total===0?"—":`${Math.round(ratio)}%`}</strong><small>actifs</small>
    </div>
   </div>
   <div><p><strong>{active}</strong> comptes actifs</p><p><strong>{inactive}</strong> comptes inactifs</p><p><strong>{total}</strong> comptes au total</p><p className="muted">L'anneau représente la répartition des comptes uniquement.</p></div>
  </div>}
  <p className="muted" style={{marginTop:14}}>Les entrées et sorties sont des nombres d'opérations enregistrées, pas des montants en ariary.</p>
 </section>;
}
