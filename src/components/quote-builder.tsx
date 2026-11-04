"use client";
import { useMemo, useState } from "react";
import type { FormEvent } from "react";
type Service={id:string;name:string;unit_price:number;tax_rate:number;unit?:string|null};
type Customer={id:string;name:string};
type Line={service_id:string;quantity:number;discount_pct:number;unit_price:number};
type Props={services:Service[];customers:Customer[];validUntil?:string;action:(data:FormData)=>void|Promise<void>};
const amount=(value:number)=>new Intl.NumberFormat("fr-FR",{maximumFractionDigits:2}).format(value);
export function QuoteBuilder({services,customers,validUntil,action}:Props){
 const [customerId,setCustomerId]=useState("");
 const [date,setDate]=useState(validUntil||"");
 const [lines,setLines]=useState<Line[]>([{service_id:services[0]?.id||"",quantity:1,discount_pct:0,unit_price:Number(services[0]?.unit_price||0)}]);
 const update=(index:number,patch:Partial<Line>)=>setLines(current=>current.map((line,i)=>i===index?{...line,...patch}:line));
 const calculated=useMemo(()=>lines.map(line=>{const service=services.find(s=>s.id===line.service_id);const gross=Math.round(line.quantity*line.unit_price*100)/100;const discount=Math.round(gross*line.discount_pct)/100;const ht=Math.round((gross-discount)*100)/100;const tax=Math.round(ht*Number(service?.tax_rate||0))/100;return {...line,service,ht,tax,ttc:ht+tax};}),[lines,services]);
 const totals=calculated.reduce((a,l)=>({ht:a.ht+l.ht,tax:a.tax+l.tax,ttc:a.ttc+l.ttc}),{ht:0,tax:0,ttc:0});
 const valid=!!customerId&&!!date&&lines.length>0&&calculated.every(l=>l.service&&Number.isFinite(l.quantity)&&l.quantity>0&&Number.isFinite(l.unit_price)&&l.unit_price>=0&&l.discount_pct>=0&&l.discount_pct<=100);
 const submit=(e:FormEvent<HTMLFormElement>)=>{if(!valid)e.preventDefault()};
 return <form action={action} onSubmit={submit} className="form">
 <input type="hidden" name="customer_id" value={customerId}/><input type="hidden" name="valid_until" value={date}/><input type="hidden" name="lines" value={JSON.stringify(lines)}/>
 <div className="grid2"><div className="field"><label>Client</label><select value={customerId} onChange={e=>setCustomerId(e.target.value)} required><option value="">Sélectionner un client</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div><div className="field"><label>Valable jusqu'au</label><input type="date" value={date} onChange={e=>setDate(e.target.value)} required/></div></div>
 <div><div className="row" style={{justifyContent:"space-between",alignItems:"center"}}><h3>Prestations du devis</h3><button type="button" className="button" onClick={()=>setLines(v=>[...v,{service_id:services[0]?.id||"",quantity:1,discount_pct:0,unit_price:Number(services[0]?.unit_price||0)}])} disabled={!services.length}>+ Ajouter une prestation</button></div>
 {lines.map((line,index)=>{const calc=calculated[index];return <div className="card" key={index} style={{marginBottom:12}}><div className="row" style={{justifyContent:"space-between",alignItems:"center"}}><strong>Prestation {index+1}</strong>{lines.length>1&&<button type="button" className="button" onClick={()=>setLines(v=>v.filter((_,i)=>i!==index))}>Supprimer</button>}</div>
 <div className="grid2"><div className="field"><label>Prestation</label><select value={line.service_id} onChange={e=>{const s=services.find(x=>x.id===e.target.value);update(index,{service_id:e.target.value,unit_price:Number(s?.unit_price||0)})}} required><option value="">Sélectionner</option>{services.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></div><div className="field"><label>Prix unitaire HT</label><input type="number" min="0" step="0.01" value={line.unit_price} onChange={e=>update(index,{unit_price:Number(e.target.value)})} required/></div></div>
 <div className="grid2"><div className="field"><label>Quantité</label><input type="number" min="0.01" step="0.01" value={line.quantity} onChange={e=>update(index,{quantity:Number(e.target.value)})} required/></div><div className="field"><label>Remise (%)</label><input type="number" min="0" max="100" step="0.01" value={line.discount_pct} onChange={e=>update(index,{discount_pct:Number(e.target.value)})} required/></div></div>
 {calc.service&&<div className="grid2"><div><span className="muted">Taxe : {calc.service.tax_rate}%</span><div>Montant HT : <strong>{amount(calc.ht)} Ar</strong></div></div><div><span className="muted">TVA : {amount(calc.tax)} Ar</span><div>Montant TTC : <strong>{amount(calc.ttc)} Ar</strong></div></div></div>}</div>})}</div>
 <div className="card"><h3>Récapitulatif du devis</h3><div className="row" style={{justifyContent:"space-between"}}><span>Total HT</span><strong>{amount(totals.ht)} Ar</strong></div><div className="row" style={{justifyContent:"space-between"}}><span>TVA</span><strong>{amount(totals.tax)} Ar</strong></div><div className="row" style={{justifyContent:"space-between"}}><span>Total TTC</span><strong>{amount(totals.ttc)} Ar</strong></div></div>
 <button className="button primary" disabled={!valid||!services.length||!customers.length}>Créer le devis brouillon</button>
 {(!services.length||!customers.length)&&<p className="error">Ajoute au moins un client et une prestation au préalable.</p>}
 </form>;
}
