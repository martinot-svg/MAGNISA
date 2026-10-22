import {requirePermission, hasPermission} from "@/lib/permissions";
import Link from "next/link";
import {requireOrganization} from "@/lib/current-org";
import {EmptyState} from "@/components/empty-state";
import {InvoiceTracker} from "@/components/invoice-tracker";

export default async function Invoices({searchParams}:{searchParams:Promise<{filtre?:string}>}){
 const ctx=await requireOrganization();await requirePermission(ctx,"billing.view");
 const {supabase,organizationId}=ctx;
 if (await hasPermission(ctx,"invoices.create")) {
  const {error: recurringError}=await supabase.rpc("generate_due_recurring_invoice_drafts",{p_org:organizationId});
  if (recurringError) throw new Error("Impossible de préparer les factures récurrentes dues. "+recurringError.message);
 }
 const [{data=[]},{data:org}]=await Promise.all([
  supabase.from("invoices").select("id,number,status,issue_date,due_date,total,paid_amount,balance_due,customers(name)").eq("organization_id",organizationId).order("created_at",{ascending:false}),
  supabase.from("organizations").select("currency").eq("id",organizationId).single()
 ]);
 const query=await searchParams;
 const initialView=query.filtre==="draft"?"draft":query.filtre==="overdue"?"overdue":query.filtre==="unpaid"?"unpaid":"all";
 const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Indian/Antananarivo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
 const rows=(data||[]).map((r:any)=>({id:String(r.id),number:String(r.number||""),status:String(r.status||""),issue_date:r.issue_date||null,due_date:r.due_date||null,total:Number(r.total||0),paid_amount:Number(r.paid_amount||0),balance_due:Number(r.balance_due||0),customer:String(r.customers?.name||"")}));
 return <>
  <div className="pageHead"><div><h1>Factures</h1><p>Suivi des factures, des brouillons à vérifier, des échéances et des encaissements.</p></div><Link className="button primary" href="/factures/nouvelle">Facture directe</Link></div>
  {!rows.length?<EmptyState title="Aucune facture" description="Transforme un devis accepté ou crée une facture directe."/>:<InvoiceTracker invoices={rows} currency={org?.currency||"MGA"} today={today} initialView={initialView}/>}
 </>;
}
