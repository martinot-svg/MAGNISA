import {canDocumentAction} from "@/lib/document-permissions";
import {hasPermission} from "@/lib/permissions";
import {NextResponse} from "next/server";
import {requireOrganization} from "@/lib/current-org";
import {renderPdf} from "@/lib/pdf/document";
export async function GET(_:Request,{params}:{params:Promise<{type:string;id:string}>}){
  const {type,id}=await params;if(!["quote","invoice"].includes(type))return new NextResponse("Type invalide",{status:400});
  const ctx=await requireOrganization();const {supabase,organizationId}=ctx;const allowed=(await canDocumentAction(ctx,"documents.export",type as "quote"|"invoice"))&&(await hasPermission(ctx,type==="quote"?"sales.view":"billing.view"));if(!allowed)return new NextResponse("Accès interdit",{status:403});const isQuote=type==="quote";const table=isQuote?"quotes":"invoices";const lineTable=isQuote?"quote_lines":"invoice_lines";const fk=isQuote?"quote_id":"invoice_id";
  const [{data:doc},{data:lines},{data:org},{data:settings},{data:template},{data:snapshot}]=await Promise.all([
    supabase.from(table).select("*,customers(name)").eq("organization_id",organizationId).eq("id",id).maybeSingle(),
    supabase.from(lineTable).select("*").eq("organization_id",organizationId).eq(fk,id).order("sort_order"),
    supabase.from("organizations").select("name,currency").eq("id",organizationId).single(),
    supabase.from("company_settings").select("*").eq("organization_id",organizationId).maybeSingle(),
    supabase.from("document_templates").select("configuration").eq("organization_id",organizationId).eq("document_type",type).eq("is_default",true).limit(1).maybeSingle(),
    supabase.from("document_appearance_snapshots").select("appearance").eq("organization_id",organizationId).eq("document_type",type).eq("document_id",id).maybeSingle()
  ]);
  if(!doc)return new NextResponse("Document introuvable",{status:404});
  const captured=snapshot?.appearance as {company?:Record<string,any>;template?:Record<string,any>}|undefined;
  const visual=captured?.company||settings;
  const buffer=await renderPdf({type:isQuote?"DEVIS":"FACTURE",number:doc.number,company:visual?.trade_name||visual?.legal_name||org?.name||"Entreprise",slogan:visual?.slogan,companyAddress:visual?.address,logoUrl:visual?.logo_url,taxId:visual?.tax_id,statId:visual?.stat_id,registryId:visual?.registry_id,bankDetails:visual?.bank_details,customer:doc.customers?.name||"Client",issueDate:doc.issue_date,dueDate:isQuote?doc.valid_until:doc.due_date,lines:(lines||[]).map((l:any)=>({description:l.description,quantity:Number(l.quantity),unitPrice:Number(l.unit_price),discountPct:Number(l.discount_pct),taxRate:Number(l.tax_rate),total:Number(l.line_total)})),subtotal:Number(doc.subtotal),discountTotal:Number(doc.discount_total||0),taxTotal:Number(doc.tax_total),total:Number(doc.total),paidAmount:isQuote?undefined:Number(doc.paid_amount||0),balanceDue:isQuote?undefined:Number(doc.balance_due||0),currency:org?.currency||"MGA",paymentTerms:visual?.payment_terms,legalMentions:visual?.legal_mentions,theme:visual?.document_theme||undefined,template:captured?captured.template:template?.configuration||undefined});
  return new NextResponse(buffer as BodyInit,{headers:{"Content-Type":"application/pdf","Content-Disposition":`inline; filename="${doc.number}.pdf"`}})
}
