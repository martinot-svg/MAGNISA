import { requirePermission } from "@/lib/permissions";
import { requireOrganization } from "@/lib/current-org";
import { QuoteBuilder } from "@/components/quote-builder";
import { createQuoteDraft } from "@/server/actions/commercial";
export default async function NewQuote(){
 const ctx=await requireOrganization();await requirePermission(ctx,"sales.view");const {supabase,organizationId}=ctx;
 const [{data:customers=[]},{data:services=[]}]=await Promise.all([
  supabase.from("customers").select("id,name").eq("organization_id",organizationId).eq("is_active",true).order("name"),
  supabase.from("services").select("id,name,unit_price,tax_rate,unit").eq("organization_id",organizationId).eq("is_active",true).order("name")
 ]);
 const validUntil=new Date(Date.now()+30*86400000).toISOString().slice(0,10);
 return <><div className="pageHead"><div><h1>Nouveau devis</h1><p>Ajoute plusieurs prestations, ajuste les prix et vérifie les totaux avant la création.</p></div></div><div className="card"><QuoteBuilder services={services} customers={customers} validUntil={validUntil} action={createQuoteDraft}/></div></>;
}
