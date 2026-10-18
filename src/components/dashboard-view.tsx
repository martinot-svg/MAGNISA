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
 const [sizes,setSizes]=useState<Record<string,number>>({});
 const [graphOrder,setGraphOrder]=useState(["activity","aging","cash","commercial"]);
 const [dragging,setDragging]=useState<string|null>(null);
 const key="magnisa:dashboard:v1:"+organizationId;
 useEffect(()=>{try{const raw=localStorage.getItem(key);if(raw){const p=JSON.parse(raw);if(["mixed","kpi","charts"].includes(p.mode))setMode(p.mode);if(["standard","compact"].includes(p.arrangement))setArrangement(p.arrangement);if(Array.isArray(p.selected))setSelected(initial.filter(x=>p.selected.includes(x)));if(Array.isArray(p.order))setOrder([...p.order.filter((x:unknown)=>typeof x==="string"&&initial.includes(x as string)),...initial.filter(x=>!p.order.includes(x))]);if(p.sizes&&typeof p.sizes==="object")setSizes(Object.fromEntries(Object.entries(p.sizes).filter(([k,v])=>[...initial,"activity","aging","commercial"].includes(k)&&[1,2].includes(Number(v)))));if(Array.isArray(p.graphOrder))setGraphOrder([...p.graphOrder.filter((x:unknown)=>typeof x==="string"&&["activity","aging","cash","commercial"].includes(x as string)),...["activity","aging","cash","commercial"].filter(x=>!p.graphOrder.includes(x))]);}}catch{}setReady(true)},[key]);
 useEffect(()=>{if(ready)try{localStorage.setItem(key,JSON.stringify({mode,arrangement,selected,order,sizes,graphOrder}));}catch{}},[key,ready,mode,arrangement,selected,order,sizes,graphOrder]);
 const ordered=order.map(id=>items.find(item=>item.id===id)).filter((item):item is Item=>Boolean(item&&selected.includes(item.id)));
 function move(id:string,direction:number){setOrder(prev=>{const copy=[...prev];const i=copy.indexOf(id),j=i+direction;if(j<0||j>=copy.length)return prev;[copy[i],copy[j]]=[copy[j],copy[i]];return copy})}
 function dropCard(target:string,type:"kpi"|"chart"){if(!dragging)return;const [dragType,source]=dragging.split(":");if(dragType!==type||source===target){setDragging(null);return;}const setter=type==="kpi"?setOrder:setGraphOrder;setter(old=>{const next=old.filter(id=>id!==source);const index=next.indexOf(target);if(index<0)return old;next.splice(index,0,source);return next});setDragging(null)}
 function widthOf(id:string){return sizes[id]===2?6:(arrangement==="compact"?3:4)}
 function resizeControl(id:string){return <button type="button" className="btn" style={{fontSize:12,padding:"4px 8px"}} onClick={()=>setSizes(old=>({...old,[id]:old[id]===2?1:2}))} aria-label={"Redimensionner "+id}>{sizes[id]===2?"Réduire":"Agrandir"}</button>}
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
    <button className="btn" type="button" onClick={()=>{setMode("mixed");setArrangement("standard");setSelected(initial);setOrder(initial);setSizes({});setGraphOrder(["activity","aging","cash","commercial"])}}>Réinitialiser la vue</button>
   </div>
   <details style={{marginTop:14}}><summary style={{cursor:"pointer",fontWeight:600}}>Personnaliser les indicateurs ({selected.length}/{items.length})</summary>
    <p className="muted" style={{margin:"8px 0"}}>Choisis plusieurs indicateurs. Déplace les cartes par glisser-déposer ou utilise les flèches. Agrandis-les selon tes besoins.</p>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:8}}>
     {order.map(id=>{const item=items.find(x=>x.id===id);if(!item)return null;return <div key={id} style={{display:"flex",gap:8,alignItems:"center",padding:"8px",border:"1px solid var(--border, #ddd)",borderRadius:8}}>
      <label style={{display:"flex",gap:8,alignItems:"center",flex:1}}><input type="checkbox" checked={selected.includes(id)} onChange={e=>setSelected(old=>e.target.checked?[...old,id]:old.filter(x=>x!==id))}/>{item.label}</label>
      <button type="button" aria-label={"Monter "+item.label} title="Monter" onClick={()=>move(id,-1)}>↑</button>
      <button type="button" aria-label={"Descendre "+item.label} title="Descendre" onClick={()=>move(id,1)}>↓</button>
     </div>})}
    </div>
   </details>
  </div>
  <style>{`@media(max-width:750px){.magnisa-tile{grid-column:span 12!important}} .magnisa-tile[draggable="true"]{cursor:grab}.magnisa-tile:focus-within{outline-offset:2px}`}</style>
  {showKpi&&(ordered.length?<div style={{display:"grid",gridTemplateColumns:"repeat(12,minmax(0,1fr))",gap:12,marginBottom:16}}>{ordered.map(item=><div className="card magnisa-tile" key={item.id} style={{gridColumn:`span ${widthOf(item.id)}`,minWidth:0}} draggable onDragStart={()=>setDragging("kpi:"+item.id)} onDragEnd={()=>setDragging(null)} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();dropCard(item.id,"kpi")}}><div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}><div className="muted">{item.label}</div>{resizeControl(item.id)}</div><div className="metric" style={{overflowWrap:"anywhere"}}>{item.value}</div></div>)}</div>:<div className="card muted">Aucun indicateur KPI sélectionné.</div>)}
  {showCharts&&<div className="section" style={{display:"grid",gridTemplateColumns:"repeat(12,minmax(0,1fr))",gap:12}}>
   {graphOrder.map(id=>{
    const active=id==="activity"?selected.some(x=>["revenue","receipts","expenses"].includes(x)):id==="aging"?selected.includes("receivables"):id==="cash"?selected.includes("cash"):selected.includes("overdue")||selected.includes("quotes");
    if(!active)return null;
    return <div key={id} className="card magnisa-tile" style={{gridColumn:`span ${sizes[id]===2?12:6}`,minWidth:0}} draggable onDragStart={()=>setDragging("chart:"+id)} onDragEnd={()=>setDragging(null)} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();dropCard(id,"chart")}}>
     <div style={{display:"flex",justifyContent:"flex-end"}}>{resizeControl(id)}</div>
     {id==="activity"&&<><h2>Activité sur 6 mois</h2><p className="muted">Chiffre d'affaires facturé, encaissements et charges.</p><ActivityBars rows={months.map(m=>({...m,revenue:selected.includes("revenue")?m.revenue:0,receipts:selected.includes("receipts")?m.receipts:0,expenses:selected.includes("expenses")?m.expenses:0}))}/></>}
     {id==="aging"&&<><h2>Ancienneté des créances</h2><p className="muted">Soldes restant dus par échéance.</p><ReceivablesAge rows={age}/></>}
     {id==="cash"&&<><h2>Trésorerie disponible</h2><div className="metric">{items.find(x=>x.id==="cash")?.value}</div><p className="muted">Solde consolidé selon les règles de trésorerie MAGNISA.</p></>}
     {id==="commercial"&&<><h2>Suivi commercial</h2>{items.filter(x=>["overdue","quotes"].includes(x.id)&&selected.includes(x.id)).map(x=><div key={x.id} style={{display:"flex",justifyContent:"space-between",gap:12,marginTop:12}}><span>{x.label}</span><strong>{x.value}</strong></div>)}</>}
    </div>
   })}
   {!selected.length&&<div className="card muted" style={{gridColumn:"span 12"}}>Sélectionne au moins un indicateur pour afficher les graphiques.</div>}
  </div>}
 </div>
}
