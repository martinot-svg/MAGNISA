import { randomUUID } from "node:crypto";
import { requirePermission } from "@/lib/permissions";
import { getEmailTemplate, renderEmailTemplate } from "@/lib/magnimail/templates";
import { notFound } from "next/navigation";
import { requireOrganization } from "@/lib/current-org";
import { money } from "@/lib/money";
import { issueInvoice, addInvoiceLine, cancelInvoiceAction } from "@/server/actions/core";
import { updateInvoiceLineAction, deleteInvoiceLineAction } from "@/server/actions/commercial";
import { issueCustomerCreditNoteAction, recordCustomerCreditNoteRefundAction } from "@/server/actions/credit-notes";
import { DocumentActions } from "@/components/document-actions";
import Link from "next/link";

export default async function InvoiceDetail({params}:{params:Promise<{id:string}>}){
 const {id}=await params;const ctx=await requireOrganization();await requirePermission(ctx,"billing.view");const {supabase,organizationId}=ctx;
 const [{data:i},{data:lines=[]},{data:org},{data:services=[]}]=await Promise.all([
  supabase.from("invoices").select("*,customers(name,email)").eq("organization_id",organizationId).eq("id",id).maybeSingle(),
  supabase.from("invoice_lines").select("*").eq("organization_id",organizationId).eq("invoice_id",id).order("sort_order"),
  supabase.from("organizations").select("currency").eq("id",organizationId).single(),
  supabase.from("services").select("id,name").eq("organization_id",organizationId).eq("is_active",true).order("name")
 ]);
 if(!i)notFound();
 const merchandiseLineIds=(lines as any[]).filter(l=>l.line_kind==="merchandise").map(l=>l.id);
 const [{data:creditNotes=[]},{data:financialAccounts=[]},{data:stockReturnLines=[]}] = await Promise.all([
  supabase.from("credit_notes").select("id,number,total,status,applied_amount,refundable_amount,refunded_amount,journal_entry_id").eq("organization_id",organizationId).eq("invoice_id",id).order("issue_date",{ascending:false}),
  supabase.from("financial_accounts").select("id,name,type,balance").eq("organization_id",organizationId).eq("is_active",true).order("name"),
  merchandiseLineIds.length
   ? supabase.from("stock_return_lines").select("id,source_invoice_line_id,quantity,stock_bucket,return_id").eq("organization_id",organizationId).in("source_invoice_line_id",merchandiseLineIds)
   : Promise.resolve({data:[] as any[]})
 ]);
 const creditNoteIds=(creditNotes as any[]).map(n=>n.id);
 const [{data:creditNoteLines=[]},{data:creditNoteRefunds=[]}] = await Promise.all([
  creditNoteIds.length ? supabase.from("credit_note_lines" as any).select("id,credit_note_id,description,quantity,total,stock_return_line_id").eq("organization_id",organizationId).in("credit_note_id",creditNoteIds) : Promise.resolve({data:[] as any[]}),
  creditNoteIds.length ? supabase.from("credit_note_refunds" as any).select("id,credit_note_id,refund_date,amount,reference").eq("organization_id",organizationId).in("credit_note_id",creditNoteIds) : Promise.resolve({data:[] as any[]})
 ]);
 const mailTemplate=await getEmailTemplate(supabase,organizationId,"invoice_send");const mailData={client:i.customers?.name||"Client",numero:i.number};const mailSubject=renderEmailTemplate(mailTemplate.subject,mailData);const mailBody=renderEmailTemplate(mailTemplate.body,mailData);const reminderHref=i.customers?.email?`/magnimail?composeTo=${encodeURIComponent(i.customers.email)}&customerId=${i.customer_id}&templateKey=invoice_reminder&numero=${encodeURIComponent(i.number)}&invoiceId=${i.id}`:"";const issue=async()=>{"use server";await issueInvoice(id)};
 return <><div className="pageHead"><div><h1>{i.number}</h1><p>{i.customers?.name} · <span className="badge">{i.status}</span></p></div><DocumentActions pdfUrl={`/api/documents/invoice/${id}/pdf`} documentType="invoice" documentId={id} email={i.customers?.email} subject={mailSubject} body={mailBody}/></div>
 {i.recurring_contract_id && <div className="card section"><h2>Facture récurrente</h2><p>Prestation liée à la commande {i.order_id ? <Link href="/commandes">associée</Link> : "d’origine"}.</p><p>Période de service : <strong>{i.service_period_start || "-"} au {i.service_period_end || "-"}</strong></p><p className="muted">Vérifie la période et le montant avant émission.</p></div>}
 <div className="tableWrap"><table><thead><tr><th>Nature</th><th>Description</th><th className="right">Qté</th><th className="right">PU</th><th className="right">Remise</th><th className="right">Total</th>{i.status==="draft"&&<th></th>}</tr></thead><tbody>{lines.map((l:any)=><tr key={l.id}><td>{l.line_kind==="service"?"Prestation":l.line_kind==="merchandise"?"Marchandise":l.line_kind}</td><td>{l.description}</td><td className="right">{i.status==="draft"&&l.line_kind==="service"?<form action={updateInvoiceLineAction} className="actions"><input type="hidden" name="line_id" value={l.id}/><input type="hidden" name="invoice_id" value={id}/><input name="quantity" type="number" min="0.01" step="0.01" defaultValue={l.quantity} style={{width:90}}/><input name="discount_pct" type="number" min="0" max="100" step="0.01" defaultValue={l.discount_pct} style={{width:90}}/><button className="button">Enregistrer</button></form>:l.quantity}</td><td className="right">{money(l.unit_price,org?.currency||"MGA")}</td><td className="right">{l.discount_pct}%</td><td className="right">{money(l.line_total,org?.currency||"MGA")}</td>{i.status==="draft"&&<td className="right">{l.line_kind==="service"&&<form action={deleteInvoiceLineAction}><input type="hidden" name="line_id" value={l.id}/><input type="hidden" name="invoice_id" value={id}/><button className="button">Supprimer</button></form>}</td>}</tr>)}</tbody></table></div>
 <div className="grid3 section"><div className="card"><div className="muted">Total</div><div className="metric">{money(i.total,org?.currency||"MGA")}</div></div><div className="card"><div className="muted">Payé</div><div className="metric">{money(i.paid_amount,org?.currency||"MGA")}</div></div><div className="card"><div className="muted">Reste dû</div><div className="metric">{money(i.balance_due,org?.currency||"MGA")}</div></div></div>
 <div className="grid2 section">{i.status==="draft"&&!i.order_id&&<div className="card"><h2>Ajouter une prestation</h2><form action={addInvoiceLine} className="form"><input type="hidden" name="invoice_id" value={id}/><div className="field"><label>Prestation</label><select name="service_id" required><option value="">Sélectionner</option>{services.map((s:any)=><option key={s.id} value={s.id}>{s.name}</option>)}</select></div><div className="grid2"><div className="field"><label>Quantité</label><input name="quantity" type="number" min="0.01" step="0.01" defaultValue="1" required/></div><div className="field"><label>Remise (%)</label><input name="discount_pct" type="number" min="0" max="100" step="0.01" defaultValue="0" required/></div></div><button className="button primary">Ajouter</button></form></div>}
 <div className="card"><h2>Actions</h2><div className="actions">{i.status==="draft"&&<form action={issue}><button className="button primary">Émettre la facture</button></form>}{i.status!=="draft"&&i.status!=="cancelled"&&i.balance_due>0&&<Link className="button primary" href={`/paiements?invoice=${id}`}>Enregistrer un paiement</Link>}{i.status!=="draft"&&i.status!=="cancelled"&&i.balance_due>0&&reminderHref&&<Link className="button" href={reminderHref}>Relancer par e-mail</Link>}</div>{i.status!=="cancelled"&&Number(i.paid_amount)===0&&<form action={cancelInvoiceAction} className="form" style={{marginTop:16}}><input type="hidden" name="invoice_id" value={id}/><div className="field"><label>Motif d'annulation</label><input name="reason" minLength={3} required/></div><button className="button">Annuler la facture</button></form>}</div></div>
 <section className="section card"><div className="pageHead"><div><h2>Avoirs et remboursements</h2><p>Les avoirs sont liés aux lignes originales. Une marchandise exige un retour physique validé avant émission.</p></div></div>
  {i.status!=="draft"&&i.status!=="cancelled"&&<form action={issueCustomerCreditNoteAction} className="form">
   <input type="hidden" name="invoice_id" value={id}/><input type="hidden" name="request_key" value={randomUUID()}/>
   <div className="grid2">
    <div className="field"><label>Ligne de facture à créditer</label><select name="invoice_line_id" required defaultValue=""><option value="" disabled>Choisir une ligne</option>{(lines as any[]).map(l=><option key={l.id} value={l.id}>{l.description} · {l.line_kind} · Qté {l.quantity}</option>)}</select></div>
    <div className="field"><label>Quantité à créditer</label><input name="quantity" type="number" min="0.0001" step="0.0001" required/></div>
    <div className="field"><label>Retour physique associé (obligatoire pour une marchandise)</label><select name="stock_return_line_id" defaultValue=""><option value="">Aucun retour / prestation</option>{(stockReturnLines as any[]).map(r=><option key={r.id} value={r.id}>Ligne {String(r.source_invoice_line_id).slice(0,8)} · Qté {r.quantity} · {r.stock_bucket}</option>)}</select></div>
    <div className="field"><label>Date de l'avoir</label><input name="issue_date" type="date" defaultValue={new Date().toISOString().slice(0,10)} required/></div>
   </div>
   <div className="field"><label>Motif</label><input name="reason" minLength={3} maxLength={500} required/></div>
   <button className="button primary">Émettre l'avoir</button>
  </form>}
  {!creditNotes.length?<p className="muted">Aucun avoir émis pour cette facture.</p>:<div className="tableWrap"><table><thead><tr><th>Référence</th><th>Total</th><th>Imputé</th><th>À rembourser</th><th>Remboursé</th><th>Statut</th><th>Lignes</th></tr></thead><tbody>{(creditNotes as any[]).map(n=><tr key={n.id}><td>{n.number}</td><td>{money(n.total,org?.currency||"MGA")}</td><td>{money(n.applied_amount,org?.currency||"MGA")}</td><td>{money(Math.max(0,Number(n.refundable_amount)-Number(n.refunded_amount)),org?.currency||"MGA")}</td><td>{money(n.refunded_amount,org?.currency||"MGA")}</td><td>{n.status}</td><td>{(creditNoteLines as any[]).filter(l=>l.credit_note_id===n.id).map(l=>l.description+" × "+l.quantity).join(", ")}</td></tr>)}</tbody></table></div>}
  {(creditNotes as any[]).some(n=>Number(n.refundable_amount)>Number(n.refunded_amount))&&<form action={recordCustomerCreditNoteRefundAction} className="form section">
   <h3>Rembourser un avoir</h3><input type="hidden" name="request_key" value={randomUUID()}/>
   <div className="grid2">
    <div className="field"><label>Avoir</label><select name="credit_note_id" required defaultValue=""><option value="" disabled>Choisir</option>{(creditNotes as any[]).filter(n=>Number(n.refundable_amount)>Number(n.refunded_amount)).map(n=><option key={n.id} value={n.id}>{n.number} · Solde {money(Number(n.refundable_amount)-Number(n.refunded_amount),org?.currency||"MGA")}</option>)}</select></div>
    <div className="field"><label>Compte de trésorerie</label><select name="financial_account_id" required defaultValue=""><option value="" disabled>Choisir</option>{(financialAccounts as any[]).map(a=><option key={a.id} value={a.id}>{a.name} · Solde {money(a.balance,org?.currency||"MGA")}</option>)}</select></div>
    <div className="field"><label>Montant</label><input name="amount" type="number" min="0.01" step="0.01" required/></div>
    <div className="field"><label>Date du remboursement</label><input name="refund_date" type="date" defaultValue={new Date().toISOString().slice(0,10)} required/></div>
    <div className="field"><label>Mode</label><select name="method" required defaultValue="bank_transfer"><option value="bank_transfer">Virement</option><option value="cash">Espèces</option><option value="mobile_money">Mobile money</option><option value="cheque">Chèque</option><option value="card">Carte</option><option value="other">Autre</option></select></div>
    <div className="field"><label>Référence</label><input name="reference" required maxLength={120}/></div>
   </div><button className="button primary">Enregistrer le remboursement</button>
  </form>}
  {(creditNoteRefunds as any[]).length>0&&<div className="tableWrap"><table><thead><tr><th>Date</th><th>Montant</th><th>Référence</th></tr></thead><tbody>{(creditNoteRefunds as any[]).map(r=><tr key={r.id}><td>{r.refund_date}</td><td>{money(r.amount,org?.currency||"MGA")}</td><td>{r.reference}</td></tr>)}</tbody></table></div>}
 </section>
</>;
}
