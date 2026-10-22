import { requirePermission } from "@/lib/permissions";
import { getEmailTemplate, renderEmailTemplate } from "@/lib/magnimail/templates";
import { notFound, redirect } from "next/navigation";
import { requireOrganization } from "@/lib/current-org";
import { money } from "@/lib/money";
import { acceptQuote, addQuoteLine, duplicateQuoteAction } from "@/server/actions/core";
import { cancelQuoteAction } from "@/server/actions/commercial";
import { DocumentActions } from "@/components/document-actions";

export default async function QuoteDetail({params}:{params:Promise<{id:string}>}){
 const {id}=await params;const ctx=await requireOrganization();await requirePermission(ctx,"sales.view");const {supabase,organizationId}=ctx;
 const [{data:q},{data:lines=[]},{data:org},{data:services=[]}]=await Promise.all([
  supabase.from("quotes").select("*,customers(name,email)").eq("organization_id",organizationId).eq("id",id).maybeSingle(),
  supabase.from("quote_lines").select("*").eq("organization_id",organizationId).eq("quote_id",id).order("sort_order"),
  supabase.from("organizations").select("currency").eq("id",organizationId).single(),
  supabase.from("services").select("id,name").eq("organization_id",organizationId).eq("is_active",true).order("name")
 ]);
 if(!q)notFound();const mailTemplate=await getEmailTemplate(supabase,organizationId,"quote_send");const mailData={client:q.customers?.name||"Client",numero:q.number};const mailSubject=renderEmailTemplate(mailTemplate.subject,mailData);const mailBody=renderEmailTemplate(mailTemplate.body,mailData);
 const accept=async()=>{"use server";await acceptQuote(id)};
 const convertToOrder=async()=>{"use server";const {supabase,organizationId}=await requireOrganization();const {data,error}=await supabase.rpc("convert_quote_to_order",{p_org:organizationId,p_quote:id});if(error)throw new Error(error.message);redirect("/commandes")};
 const duplicate=async()=>{"use server";const newId=await duplicateQuoteAction(id);redirect(`/devis/${newId}`)};
 const cancellable=["draft","sent","negotiating"].includes(q.status);
 return <><div className="pageHead"><div><h1>{q.number}</h1><p>{q.customers?.name} · <span className="badge">{q.status}</span></p></div><DocumentActions pdfUrl={`/api/documents/quote/${id}/pdf`} documentType="quote" documentId={id} email={q.customers?.email} subject={mailSubject} body={mailBody}/></div>
 <div className="tableWrap"><table><thead><tr><th>Prestation</th><th className="right">Qté</th><th className="right">PU</th><th className="right">Remise</th><th className="right">Taxe</th><th className="right">Total</th></tr></thead><tbody>{lines.map((l:any)=><tr key={l.id}><td>{l.description}</td><td className="right">{l.quantity}</td><td className="right">{money(l.unit_price,org?.currency||"MGA")}</td><td className="right">{l.discount_pct}%</td><td className="right">{l.tax_rate}%</td><td className="right">{money(l.line_total,org?.currency||"MGA")}</td></tr>)}</tbody></table></div>
 <div className="grid2 section"><div className="card"><div className="muted">Total</div><div className="metric">{money(q.total,org?.currency||"MGA")}</div><div className="actions">{cancellable&&<form action={accept}><button className="button">Accepter le devis</button></form>}{q.status==="accepted"&&<form action={convertToOrder}><button className="button primary">Créer la commande</button></form>}<form action={duplicate}><button className="button">Dupliquer</button></form></div>{cancellable&&<form action={cancelQuoteAction} className="form" style={{marginTop:16}}><input type="hidden" name="quote_id" value={id}/><div className="field"><label>Motif d'annulation</label><input name="reason" minLength={3} required/></div><button className="button">Annuler le devis</button></form>}</div>
 {cancellable&&<div className="card"><h2>Ajouter une prestation</h2><form action={addQuoteLine} className="form"><input type="hidden" name="quote_id" value={id}/><div className="field"><label>Prestation</label><select name="service_id" required><option value="">Sélectionner</option>{services.map((s:any)=><option key={s.id} value={s.id}>{s.name}</option>)}</select></div><div className="grid2"><div className="field"><label>Quantité</label><input name="quantity" type="number" min="0.01" step="0.01" defaultValue="1" required/></div><div className="field"><label>Remise (%)</label><input name="discount_pct" type="number" min="0" max="100" step="0.01" defaultValue="0" required/></div></div><button className="button primary">Ajouter</button></form></div>}</div></>;
}
