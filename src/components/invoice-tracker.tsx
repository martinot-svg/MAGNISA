"use client";
import {useMemo,useState} from "react";
import Link from "next/link";
type Invoice={id:string;number:string;status:string;issue_date:string|null;due_date:string|null;total:number;paid_amount:number;balance_due:number;customer:string};
type View="all"|"unpaid"|"overdue";
const excluded=["draft","cancelled","paid"];
const formats:Record<string,string>={draft:"Brouillon",issued:"Émise",sent:"Envoyée",partially_paid:"Partiellement payée",paid:"Payée",cancelled:"Annulée",overdue:"En retard"};
export function InvoiceTracker({invoices,currency,today,initialView="all"}:{invoices:Invoice[];currency:string;today:string;initialView?:"all"|"unpaid"|"overdue"}){
 const [view,setView]=useState<View>(initialView),[search,setSearch]=useState("");
 const outstanding=(r:Invoice)=>!excluded.includes(r.status)&&r.balance_due>0;
 const overdue=(r:Invoice)=>outstanding(r)&&Boolean(r.due_date&&r.due_date<today);
 const unpaid=invoices.filter(outstanding),late=unpaid.filter(overdue);
 const visible=useMemo(()=>invoices.filter(r=>(view==="all"||view==="unpaid"&&outstanding(r)||view==="overdue"&&overdue(r))&&[r.number,r.customer].some(s=>s.toLocaleLowerCase("fr").includes(search.trim().toLocaleLowerCase("fr")))),[invoices,view,search,today]);
 const total=unpaid.reduce((sum,r)=>sum+r.balance_due,0),lateTotal=late.reduce((sum,r)=>sum+r.balance_due,0);
 const fmt=(v:number)=>new Intl.NumberFormat("fr-FR",{style:"currency",currency}).format(v);
 return <section className="invoice-tracker">
  <div className="invoice-tracker-metrics">
   <div className="card"><div className="muted">Créances clients</div><div className="metric">{fmt(total)}</div><small>{unpaid.length} facture(s) à encaisser</small></div>
   <div className="card"><div className="muted">Montant en retard</div><div className="metric">{fmt(lateTotal)}</div><small>{late.length} facture(s) échue(s)</small></div>
  </div>
  <div className="card invoice-tracker-panel">
   <div className="invoice-tracker-controls">
    <div className="invoice-tracker-tabs" role="group" aria-label="Filtrer les factures">
     {([["all","Toutes"],["unpaid","Impayées"],["overdue","En retard"]] as const).map(([id,label])=><button type="button" key={id} className={view===id?"active":""} aria-pressed={view===id} onClick={()=>setView(id)}>{label} <span>{id==="all"?invoices.length:id==="unpaid"?unpaid.length:late.length}</span></button>)}
    </div>
    <label className="invoice-tracker-search"><span className="sr-only">Rechercher un numéro ou un client</span><input type="search" placeholder="Rechercher une facture ou un client" value={search} onChange={e=>setSearch(e.target.value)}/></label>
   </div>
   <p className="muted invoice-tracker-helper">Les brouillons et les factures annulées ne sont pas des créances exigibles. Les factures partiellement réglées restent visibles tant que leur solde n'est pas nul.</p>
   <div className="tableWrap"><table><thead><tr><th>Numéro</th><th>Client</th><th>Statut</th><th>Échéance</th><th className="right">Total</th><th className="right">Payé</th><th className="right">Reste dû</th><th>Action</th></tr></thead><tbody>
    {visible.map(r=><tr key={r.id}><td><strong>{r.number}</strong></td><td>{r.customer||"Client non renseigné"}</td><td><span className={"badge "+(overdue(r)?"invoice-status-late":"")}>{overdue(r)?"En retard":formats[r.status]||r.status}</span></td><td>{r.due_date||"-"}</td><td className="right">{fmt(r.total)}</td><td className="right">{fmt(r.paid_amount)}</td><td className="right"><strong>{fmt(r.balance_due)}</strong></td><td><div className="actions"><Link href={`/factures/${r.id}`}>Ouvrir</Link>{outstanding(r)&&<Link href={`/paiements?invoice=${encodeURIComponent(r.id)}`}>Paiement</Link>}</div></td></tr>)}
    {!visible.length&&<tr><td colSpan={8} className="invoice-tracker-empty">Aucune facture ne correspond aux critères sélectionnés.</td></tr>}
   </tbody></table></div>
   <div className="invoice-tracker-foot"><strong>{visible.length} facture(s) affichée(s)</strong><span>Reste dû affiché : {fmt(visible.reduce((s,r)=>s+(outstanding(r)?r.balance_due:0),0))}</span></div>
  </div>
 </section>;
}
