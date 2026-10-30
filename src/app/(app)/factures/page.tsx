import {requirePermission, hasPermission} from "@/lib/permissions";
import Link from "next/link";
import {requireOrganization} from "@/lib/current-org";
import {EmptyState} from "@/components/empty-state";
import {InvoiceTracker} from "@/components/invoice-tracker";
import {InvoiceBuilder} from "@/components/invoice-builder";
import {FormDialog} from "@/components/form-dialog";
import {createInvoiceDraft} from "@/server/actions/commercial";

export default async function Invoices({searchParams}:{searchParams:Promise<{filtre?:string}>}){
 const ctx=await requireOrganization();await requirePermission(ctx,"billing.view");
 const {supabase,organizationId}=ctx;
 if (await hasPermission(ctx,"invoices.create")) {
  const {error: recurringError}=await supabase.rpc("generate_due_recurring_invoice_drafts",{p_org:organizationId});
  if (recurringError) throw new Error("Impossible de préparer les factures récurrentes dues. "+recurringError.message);
 }
 const [{data=[]},{data:org},{data:customers=[]},{data:services=[]},{data:settings}]=await Promise.all([
  supabase.from("invoices").select("id,number,status,issue_date,due_date,total,paid_amount,balance_due,customers(name)").eq("organization_id",organizationId).order("created_at",{ascending:false}),
  supabase.from("organizations").select("currency").eq("id",organizationId).single(),
  supabase.from("customers").select("id,name").eq("organization_id",organizationId).eq("is_active",true).order("name"),
  supabase.from("services").select("id,name,unit_price,tax_rate").eq("organization_id",organizationId).eq("is_active",true).order("name"),
  supabase.from("company_settings").select("default_payment_days").eq("organization_id",organizationId).maybeSingle()
 ]);
 const query=await searchParams;
 const initialView=query.filtre==="draft"?"draft":query.filtre==="overdue"?"overdue":query.filtre==="unpaid"?"unpaid":"all";
 const dueDate=new Date(Date.now()+Number(settings?.default_payment_days||30)*86400000).toISOString().slice(0,10);
 const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Indian/Antananarivo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
 const rows=(data||[]).map((r:any)=>({id:String(r.id),number:String(r.number||""),status:String(r.status||""),issue_date:r.issue_date||null,due_date:r.due_date||null,total:Number(r.total||0),paid_amount:Number(r.paid_amount||0),balance_due:Number(r.balance_due||0),customer:String(r.customers?.name||"")}));
 return <>
  <div className="pageHead"><div><h1>Factures</h1><p>Suivi des factures, des brouillons à vérifier, des échéances et des encaissements.</p></div><FormDialog title="Facture directe" buttonLabel="Facture directe"><InvoiceBuilder services={services} customers={customers} initialLines={[]} dueDate={dueDate} action={createInvoiceDraft}/></FormDialog></div>
  {!rows.length?<EmptyState title="Aucune facture" description="Transforme un devis accepté ou crée une facture directe."/>:<InvoiceTracker invoices={rows} currency={org?.currency||"MGA"} today={today} initialView={initialView}/>}
 </>;
}
