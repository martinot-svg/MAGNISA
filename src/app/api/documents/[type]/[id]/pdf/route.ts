import {NextResponse} from "next/server";
import {requireOrganization} from "@/lib/current-org";
import {renderPdf} from "@/lib/pdf/document";
export async function GET(_:Request,{params}:{params:Promise<{type:string;id:string}>}){
  const {type,id}=await params;if(!["quote","invoice"].includes(type))return new NextResponse("Type invalide",{status:400});
  const {supabase,organizationId}=await requireOrganization();const isQuote=type==="quote";const table=isQuote?"quotes":"invoices";const lineTable=isQuote?"quote_lines":"invoice_lines";const fk=isQuote?"quote_id":"invoice_id";
  const [{data:doc},{data:lines},{data:org},{data:settings},{data:template}]=await Promise.all([
    supabase.from(table).select("*,customers(name)").eq("organization_id",organizationId).eq("id",id).maybeSingle(),
    supabase.from(lineTable).select("*").eq("organization_id",organizationId).eq(fk,id).order("sort_order"),
    supabase.from("organizations").select("name,currency").eq("id",organizationId).single(),
    supabase.from("company_settings").select("*").eq("organization_id",organizationId).maybeSingle(),
    supabase.from("document_templates").select("configuration").eq("organization_id",organizationId).eq("document_type",type).eq("is_default",true).limit(1).maybeSingle()
  ]);
  if(!doc)return new NextResponse("Document introuvable",{status:404});
  const buffer=await renderPdf({type:isQuote?"DEVIS":"FACTURE",number:doc.number,company:settings?.trade_name||settings?.legal_name||org?.name||"Entreprise",slogan:settings?.slogan,companyAddress:settings?.address,logoUrl:settings?.logo_url,taxId:settings?.tax_id,statId:settings?.stat_id,registryId:settings?.registry_id,bankDetails:settings?.bank_details,customer:doc.customers?.name||"Client",issueDate:doc.issue_date,dueDate:isQuote?doc.valid_until:doc.due_date,lines:(lines||[]).map((l:any)=>({description:l.description,quantity:Number(l.quantity),unitPrice:Number(l.unit_price),discountPct:Number(l.discount_pct),taxRate:Number(l.tax_rate),total:Number(l.line_total)})),subtotal:Number(doc.subtotal),discountTotal:Number(doc.discount_total||0),taxTotal:Number(doc.tax_total),total:Number(doc.total),paidAmount:isQuote?undefined:Number(doc.paid_amount||0),balanceDue:isQuote?undefined:Number(doc.balance_due||0),currency:org?.currency||"MGA",paymentTerms:settings?.payment_terms,legalMentions:settings?.legal_mentions,template:template?.configuration||undefined});
  return new NextResponse(buffer as BodyInit,{headers:{"Content-Type":"application/pdf","Content-Disposition":`inline; filename="${doc.number}.pdf"`}})
}
