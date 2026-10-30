import { requirePermission } from "@/lib/permissions";
import Link from "next/link";
import { requireOrganization } from "@/lib/current-org";
import { EmptyState } from "@/components/empty-state";
import { money } from "@/lib/money";
import { FormDialog } from "@/components/form-dialog";
import { QuoteBuilder } from "@/components/quote-builder";
import { createQuoteDraft } from "@/server/actions/commercial";
export default async function Quotes(){
 const ctx=await requireOrganization();await requirePermission(ctx,"sales.view");const {supabase,organizationId}=ctx;
 const [{data=[]},{data:org},{data:customers=[]},{data:services=[]}]=await Promise.all([
  supabase.from("quotes").select("id,number,status,issue_date,valid_until,total,customers(name)").eq("organization_id",organizationId).order("created_at",{ascending:false}),
  supabase.from("organizations").select("currency").eq("id",organizationId).single(),
  supabase.from("customers").select("id,name").eq("organization_id",organizationId).eq("is_active",true).order("name"),
  supabase.from("services").select("id,name,unit_price,tax_rate,unit").eq("organization_id",organizationId).eq("is_active",true).order("name")
 ]);
 const validUntil=new Date(Date.now()+30*86400000).toISOString().slice(0,10);
 return <><div className="pageHead"><div><h1>Devis</h1><p>Brouillon, envoi, acceptation et conversion en facture.</p></div><FormDialog title="Nouveau devis" buttonLabel="Nouveau devis"><QuoteBuilder services={services} customers={customers} validUntil={validUntil} action={createQuoteDraft}/></FormDialog></div>
 {!data.length?<EmptyState title="Aucun devis" description="Crée un devis à partir d'un client et de plusieurs prestations."/>:<div className="tableWrap"><table><thead><tr><th>Numéro</th><th>Client</th><th>Statut</th><th>Date</th><th>Validité</th><th className="right">Total TTC</th><th></th></tr></thead><tbody>{data.map((q:any)=><tr key={q.id}><td>{q.number}</td><td>{q.customers?.name}</td><td><span className="badge">{q.status}</span></td><td>{q.issue_date}</td><td>{q.valid_until}</td><td className="right">{money(q.total,org?.currency||"MGA")}</td><td><Link href={`/devis/${q.id}`}>Ouvrir</Link></td></tr>)}</tbody></table></div>}</>;
}
