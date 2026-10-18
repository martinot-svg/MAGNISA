"use client";
import {useEffect,useState} from "react";
import {ActivityBars,ReceivablesAge} from "@/components/data-charts";

type Month={key:string;label:string;revenue:number;receipts:number;expenses:number};
type Age={label:string;value:number};
type Item={id:string;label:string;value:string};
const initial=["revenue","receipts","expenses","receivables","cash","overdue","quotes"];
type Mode="mixed"|"kpi"|"charts";
type Arrangement="standard"|"compact";
export function DashboardView({organizationId,items,months,age}:{organizationId:string;items:Item[];months:Month[];age:Age[]}){
 const [mode,setMode]=useState<Mode>("mixed");
 const [arrangement,setArrangement]=useState<Arrangement>("standard");
 const [selected,setSelected]=useState<string[]>(initial);
 const [order,setOrder]=useState<string[]>(initial);
 const [ready,setReady]=useState(false);
 const key="magnisa:dashboard:v1:"+organizationId;
 useEffect(()=>{try{const raw=localStorage.getItem(key);if(raw){const p=JSON.parse(raw);if(["mixed","kpi","charts"].includes(p.mode))setMode(p.mode);if(["standard","compact"].includes(p.arrangement))setArrangement(p.arrangement);if(Array.isArray(p.selected))setSelected(initial.filter(x=>p.selected.includes(x)));if(Array.isArray(p.order))setOrder([...initial.filter(x=>p.order.includes(x)),...initial.filter(x=>!p.order.includes(x))]);}}catch{}setReady(true)},[key]);
 useEffect(()=>{if(ready)try{localStorage.setItem(key,JSON.stringify({mode,arrangement,selected,order}));}catch{}},[key,ready,mode,arrangement,selected,order]);
 const ordered=order.map(id=>items.find(item=>item.id===id)).filter((item):item is Item=>Boolean(item&&selected.includes(item.id)));
 function move(id:string,direction:number){setOrder(prev=>{const copy=[...prev];const i=copy.indexOf(id),j=i+direction;if(j<0||j>=copy.length)return prev;[copy[i],copy[j]]=[copy[j],copy[i]];return copy})}
 const showKpi=mode!=="charts",showCharts=mode!=="kpi";
 return <div className="section">
  <div className="card" style={{marginBottom:16}}>
   <div style={{display:"flex",gap:16,flexWrap:"wrap",alignItems:"end"}}>
    <label style={{display:"grid",gap:6,flex:"1 1 200px"}}>Mode de visualisation
     <select className="input" aria-label="Mode de visualisation" value={mode} onChange={e=>setMode(e.target.value as Mode)}>
      <option value="mixed">Vue combinée - KPI et graphiques</option><option value="kpi">Indicateurs KPI</option><option value="charts">Graphiques</option>
     </select>
    </label>
    <label style={{display:"grid",gap:6,flex:"1 1 170px"}}>Disposition
     <select className="input" aria-label="Disposition" value={arrangement} onChange={e=>setArrangement(e.target.value as Arrangement)}>
      <option value="standard">Standard</option><option value="compact">Compacte</option>
     </select>
    </label>
    <button className="btn" type="button" onClick={()=>{setMode("mixed");setArrangement("standard");setSelected(initial);setOrder(initial)}}>Réinitialiser la vue</button>
   </div>
   <details style={{marginTop:14}}><summary style={{cursor:"pointer",fontWeight:600}}>Personnaliser les indicateurs ({selected.length}/{items.length})</summary>
    <p className="muted" style={{margin:"8px 0"}}>Choisis plusieurs indicateurs et ajuste leur ordre avec les flèches.</p>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:8}}>
     {order.map(id=>{const item=items.find(x=>x.id===id);if(!item)return null;return <div key={id} style={{display:"flex",gap:8,alignItems:"center",padding:"8px",border:"1px solid var(--border, #ddd)",borderRadius:8}}>
      <label style={{display:"flex",gap:8,alignItems:"center",flex:1}}><input type="checkbox" checked={selected.includes(id)} onChange={e=>setSelected(old=>e.target.checked?[...old,id]:old.filter(x=>x!==id))}/>{item.label}</label>
      <button type="button" aria-label={"Monter "+item.label} title="Monter" onClick={()=>move(id,-1)}>↑</button>
      <button type="button" aria-label={"Descendre "+item.label} title="Descendre" onClick={()=>move(id,1)}>↓</button>
     </div>})}
    </div>
   </details>
  </div>
  {showKpi&&(ordered.length?<div className={arrangement==="compact"?"grid4":"grid3"} style={{marginBottom:16}}>{ordered.map(item=><div className="card" key={item.id}><div className="muted">{item.label}</div><div className="metric">{item.value}</div></div>)}</div>:<div className="card muted">Aucun indicateur KPI sélectionné.</div>)}
  {showCharts&&<div className="twoCols section" style={arrangement==="compact"?{gap:10}:undefined}>
   {(selected.some(x=>["revenue","receipts","expenses"].includes(x)))&&<div className="card"><h2>Activité sur 6 mois</h2><p className="muted">Chiffre d'affaires facturé, encaissements et charges. Les séries masquées sont exclues.</p><ActivityBars rows={months.map(m=>({...m,revenue:selected.includes("revenue")?m.revenue:0,receipts:selected.includes("receipts")?m.receipts:0,expenses:selected.includes("expenses")?m.expenses:0}))}/></div>}
   {selected.includes("receivables")&&<div className="card"><h2>Ancienneté des créances</h2><p className="muted">Soldes restant dus par échéance.</p><ReceivablesAge rows={age}/></div>}
   {selected.includes("cash")&&<div className="card"><h2>Trésorerie disponible</h2><div className="metric">{items.find(x=>x.id==="cash")?.value}</div><p className="muted">Solde consolidé selon les comptes et règles de trésorerie MAGNISA. Aucun transfert interne n'est ajouté aux recettes.</p></div>}
   {(selected.includes("overdue")||selected.includes("quotes"))&&<div className="card"><h2>Suivi commercial</h2>{items.filter(x=>["overdue","quotes"].includes(x.id)&&selected.includes(x.id)).map(x=><div key={x.id} style={{display:"flex",justifyContent:"space-between",gap:12,marginTop:12}}><span>{x.label}</span><strong>{x.value}</strong></div>)}</div>}
   {!selected.length&&<div className="card muted">Sélectionne au moins un indicateur pour afficher les graphiques.</div>}
  </div>}
 </div>
}
