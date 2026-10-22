"use client";
import { useMemo, useState } from "react";
import type { FormEvent } from "react";
type Line = { service_id: string; quantity: number; discount_pct: number };
type Service = { id: string; name: string; unit_price: number; tax_rate: number };
type Customer = { id: string; name: string };
export function InvoiceBuilder({ services, customers, initialLines, initialCustomerId, dueDate, orderId, action }: { services: Service[]; customers: Customer[]; initialLines: Line[]; initialCustomerId?: string; dueDate: string; orderId?: string | null; action: (formData: FormData) => void | Promise<void> }) {
  const [customerId, setCustomerId] = useState(initialCustomerId || "");
  const [lines, setLines] = useState<Line[]>(initialLines.length ? initialLines : [{ service_id: services[0]?.id || "", quantity: 1, discount_pct: 0 }]);
  const total = useMemo(() => lines.reduce((sum, line) => { const s = services.find(x => x.id === line.service_id); if (!s) return sum; const gross = line.quantity * Number(s.unit_price); const taxable = gross - gross * line.discount_pct / 100; return sum + taxable + taxable * Number(s.tax_rate) / 100; }, 0), [lines, services]);
  const update = (index: number, patch: Partial<Line>) => setLines(current => current.map((line, i) => i === index ? { ...line, ...patch } : line));
  const submit = (event: FormEvent<HTMLFormElement>) => { if (!customerId || !lines.length || lines.some(l => !l.service_id || l.quantity <= 0 || l.discount_pct < 0 || l.discount_pct > 100)) event.preventDefault(); };
  return <form action={action} onSubmit={submit} className="form">
    <input type="hidden" name="customer_id" value={customerId}/><input type="hidden" name="due_date" value={dueDate}/><input type="hidden" name="order_id" value={orderId || ""}/><input type="hidden" name="lines" value={JSON.stringify(lines)}/>
    <div className="field"><label>Client</label><select value={customerId} onChange={e=>setCustomerId(e.target.value)} required><option value="">Sélectionner</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
    <div className="field"><label>Échéance</label><input type="date" value={dueDate} readOnly/></div>
    {lines.map((line,index)=><div className="card" key={`${index}-${line.service_id}`} style={{marginBottom:12}}><div className="grid2"><div className="field"><label>Prestation</label><select value={line.service_id} onChange={e=>update(index,{service_id:e.target.value})} required><option value="">Sélectionner</option>{services.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></div><div className="field"><label>Quantité</label><input type="number" min="0.01" step="0.01" value={line.quantity} onChange={e=>update(index,{quantity:Number(e.target.value)})} required/></div></div><div className="grid2"><div className="field"><label>Remise (%)</label><input type="number" min="0" max="100" step="0.01" value={line.discount_pct} onChange={e=>update(index,{discount_pct:Number(e.target.value)})} required/></div><div className="actions" style={{alignItems:"end"}}>{lines.length>1&&<button type="button" className="button" onClick={()=>setLines(current=>current.filter((_,i)=>i!==index))}>Supprimer</button>}</div></div></div>)}
    <div className="actions"><button type="button" className="button" onClick={()=>setLines(current=>[...current,{service_id:services[0]?.id||"",quantity:1,discount_pct:0}])}>+ Ajouter une prestation</button><button className="button primary" disabled={!services.length||!customers.length}>Créer la facture brouillon</button></div><p className="muted">Total estimé : {new Intl.NumberFormat("fr-FR").format(Math.round(total))} Ar</p>
  </form>;
}
