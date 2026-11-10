"use client";
import { useMemo, useState } from "react";
import type { FormEvent } from "react";

type Line={
 line_kind:"service"|"merchandise";
 service_id?:string;
 item_id?:string;
 description?:string;
 unit?:string|null;
 quantity:number;
 discount_pct:number;
 unit_price:number;
 order_line_id?:string;
 tax_rate?:number;
 max_quantity?:number;
};
type Service={id:string;name:string;unit_price:number;tax_rate:number;unit?:string|null};
type Customer={id:string;name:string};
type InitialLine=Partial<Line>&Pick<Line,"line_kind"|"quantity"|"discount_pct"|"unit_price">;

export function InvoiceBuilder({services,customers,initialLines,initialCustomerId,dueDate,orderId,action}:{services:Service[];customers:Customer[];initialLines:InitialLine[];initialCustomerId?:string;dueDate:string;orderId?:string|null;action:(formData:FormData)=>void|Promise<void>}){
 const initial=()=>initialLines.length
  ?initialLines.map(l=>({...l,service_id:l.service_id||"",unit_price:Number(l.unit_price??services.find(s=>s.id===l.service_id)?.unit_price??0)}))
  :orderId?[]:[{line_kind:"service" as const,service_id:services[0]?.id||"",quantity:1,discount_pct:0,unit_price:Number(services[0]?.unit_price||0),tax_rate:Number(services[0]?.tax_rate||0)}];
 const [customerId,setCustomerId]=useState(initialCustomerId||"");
 const [lines,setLines]=useState<Line[]>(initial);
 const update=(index:number,patch:Partial<Line>)=>setLines(v=>v.map((l,i)=>i===index?{...l,...patch}:l));
 const calculated=useMemo(()=>lines.map(l=>{
  const service=l.line_kind==="service"?services.find(s=>s.id===l.service_id):undefined;
  const gross=Math.round(l.quantity*l.unit_price*100)/100;
  const discount=Math.round(gross*l.discount_pct)/100;
  const ht=Math.round((gross-discount)*100)/100;
  const rate=Number(l.tax_rate??service?.tax_rate??0);
  const tax=Math.round(ht*rate)/100;
  return {...l,service,tax_rate:rate,ht,tax,ttc:ht+tax};
 }),[lines,services]);
 const totals=calculated.reduce((a,l)=>({ht:a.ht+l.ht,tax:a.tax+l.tax,ttc:a.ttc+l.ttc}),{ht:0,tax:0,ttc:0});
 const fmt=(v:number)=>new Intl.NumberFormat("fr-FR",{maximumFractionDigits:2}).format(v);
 const valid=!!customerId&&lines.length>0&&calculated.every(l=>
  l.quantity>0&&Number.isFinite(l.quantity)&&l.unit_price>=0&&Number.isFinite(l.unit_price)&&l.discount_pct>=0&&l.discount_pct<=100&&
  (l.line_kind==="service"?!!l.service:!!l.item_id&&!!l.order_line_id&&!!l.max_quantity&&l.quantity<=l.max_quantity)
 );
 const submit=(e:FormEvent<HTMLFormElement>)=>{if(!valid)e.preventDefault()};
 return <form action={action} onSubmit={submit} className="form">
  <input type="hidden" name="customer_id" value={customerId}/>
  <input type="hidden" name="due_date" value={dueDate}/>
  <input type="hidden" name="order_id" value={orderId||""}/>
  <input type="hidden" name="lines" value={JSON.stringify(lines)}/>
  <div className="grid2"><div className="field"><label>Client</label><select value={customerId} onChange={e=>setCustomerId(e.target.value)} required><option value="">Sélectionner</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div><div className="field"><label>Échéance</label><input type="date" value={dueDate} readOnly/></div></div>
  <div>
   <div className="row" style={{justifyContent:"space-between",alignItems:"center"}}><h3>Lignes de la facture</h3>{!orderId&&<button type="button" className="button" disabled={!services.length} onClick={()=>setLines(v=>[...v,{line_kind:"service",service_id:services[0]?.id||"",quantity:1,discount_pct:0,unit_price:Number(services[0]?.unit_price||0),tax_rate:Number(services[0]?.tax_rate||0)}])}>+ Ajouter une prestation</button>}</div>
   {!lines.length&&<p className="muted">Aucune quantité n'est actuellement facturable sur cette commande. Les marchandises ne deviennent facturables qu'après leur livraison.</p>}
   {lines.map((line,index)=>{const c=calculated[index];return <div className="card" key={index} style={{marginBottom:12}}>
    <div className="row" style={{justifyContent:"space-between",alignItems:"center"}}><strong>{line.line_kind==="service"?"Prestation":"Marchandise"} {index+1}</strong>{lines.length>1&&<button type="button" className="button" onClick={()=>setLines(v=>v.filter((_,i)=>i!==index))}>Supprimer</button>}</div>
    {line.line_kind==="service"
     ?<div className="grid2"><div className="field"><label>Prestation</label><select value={line.service_id||""} onChange={e=>{const s=services.find(x=>x.id===e.target.value);update(index,{service_id:e.target.value,unit_price:Number(s?.unit_price||0),tax_rate:Number(s?.tax_rate||0),order_line_id:undefined})}} required><option value="">Sélectionner</option>{services.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></div><div className="field"><label>Prix unitaire HT</label><input type="number" min="0" step="0.01" value={line.unit_price} onChange={e=>update(index,{unit_price:Number(e.target.value)})} required/></div></div>
     :<div className="grid2"><div className="field"><label>Article livré</label><input value={line.description||"Article du catalogue"} readOnly/><input type="hidden" value={line.item_id||""}/></div><div className="field"><label>Prix unitaire HT (commande)</label><input value={fmt(line.unit_price)} readOnly/></div></div>}
    <div className="grid2"><div className="field"><label>Quantité à facturer</label><input type="number" min="0.01" max={line.line_kind==="merchandise"?line.max_quantity:undefined} step="0.01" value={line.quantity} onChange={e=>update(index,{quantity:Number(e.target.value)})} required/></div><div className="field"><label>Remise (%)</label>{line.line_kind==="service"?<input type="number" min="0" max="100" step="0.01" value={line.discount_pct} onChange={e=>update(index,{discount_pct:Number(e.target.value)})} required/>:<input value={line.discount_pct} readOnly/>}</div></div>
    <div className="grid2"><div><span className="muted">Taxe : {c.tax_rate}%</span><div>Montant HT : <strong>{fmt(c.ht)} Ar</strong></div></div><div><span className="muted">TVA : {fmt(c.tax)} Ar</span><div>Montant TTC : <strong>{fmt(c.ttc)} Ar</strong></div></div></div>
   </div>})}
  </div>
  <div className="card"><h3>Récapitulatif de la facture</h3><div className="row" style={{justifyContent:"space-between"}}><span>Total HT</span><strong>{fmt(totals.ht)} Ar</strong></div><div className="row" style={{justifyContent:"space-between"}}><span>TVA</span><strong>{fmt(totals.tax)} Ar</strong></div><div className="row" style={{justifyContent:"space-between"}}><span>Total TTC</span><strong>{fmt(totals.ttc)} Ar</strong></div></div>
  <button className="button primary" disabled={!valid||!customers.length}>Créer la facture brouillon</button>
 </form>;
}
