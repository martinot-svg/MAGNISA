import { requirePermission } from "@/lib/permissions";
import { requireOrganization } from "@/lib/current-org";
import { InvoiceBuilder } from "@/components/invoice-builder";
import { createInvoiceDraft } from "@/server/actions/commercial";

export default async function NewInvoice({ searchParams }: { searchParams: Promise<{ orderId?: string }> }) {
  const params = await searchParams;
  const ctx = await requireOrganization();
  await requirePermission(ctx, "billing.view");
  const { supabase, organizationId } = ctx;
  const [{ data: customers = [] }, { data: services = [] }, { data: settings }] = await Promise.all([
    supabase.from("customers").select("id,name").eq("organization_id", organizationId).eq("is_active", true).order("name"),
    supabase.from("services").select("id,name,unit_price,tax_rate").eq("organization_id", organizationId).eq("is_active", true).order("name"),
    supabase.from("company_settings").select("default_payment_days").eq("organization_id", organizationId).maybeSingle(),
  ]);
  const orderId = params.orderId?.trim() || null;
  let initialCustomerId: string | undefined;
  let initialLines: any[] = [];
  let orderNumber = "";
  if (orderId) {
    const [{ data: order }, { data: orderLines = [] }] = await Promise.all([
      supabase.from("orders").select("id,number,customer_id,status,invoices(id,status)").eq("organization_id", organizationId).eq("id", orderId).maybeSingle(),
      supabase.from("order_lines").select("id,service_id,item_id,line_kind,description,unit,quantity,delivered_quantity,unit_price,tax_rate,discount_pct").eq("organization_id", organizationId).eq("order_id", orderId).order("sort_order"),
    ]);
    if (order && ["confirmed", "in_progress", "completed"].includes(order.status)) {
      initialCustomerId = order.customer_id;
      orderNumber = order.number;
      const activeInvoiceIds = (order.invoices || []).filter((invoice:any)=>invoice.status!=="cancelled").map((invoice:any)=>invoice.id);
      const {data: invoicedLines=[]} = activeInvoiceIds.length
        ? await supabase.from("invoice_lines").select("source_order_line_id,quantity").eq("organization_id",organizationId).in("invoice_id",activeInvoiceIds)
        : {data:[] as any[]};
      const invoicedByOrderLine = new Map<string,number>();
      for(const line of invoicedLines as any[]){
        if(!line.source_order_line_id) continue;
        invoicedByOrderLine.set(line.source_order_line_id,(invoicedByOrderLine.get(line.source_order_line_id)||0)+Number(line.quantity||0));
      }
      for(const line of orderLines as any[]){
        const alreadyInvoiced=invoicedByOrderLine.get(line.id)||0;
        if(line.line_kind==="service"&&line.service_id){
          const remaining=Number(line.quantity)-alreadyInvoiced;
          if(remaining>0) initialLines.push({
            line_kind:"service",service_id:line.service_id,order_line_id:line.id,
            quantity:remaining,discount_pct:Number(line.discount_pct||0),
            unit_price:Number(line.unit_price),tax_rate:Number(line.tax_rate||0),
          });
        }else if(line.item_id&&line.line_kind==="merchandise"){
          const remaining=Number(line.delivered_quantity||0)-alreadyInvoiced;
          if(remaining>0) initialLines.push({
            line_kind:"merchandise",item_id:line.item_id,order_line_id:line.id,
            description:line.description,unit:line.unit,quantity:remaining,max_quantity:remaining,
            discount_pct:Number(line.discount_pct||0),unit_price:Number(line.unit_price),
            tax_rate:Number(line.tax_rate||0),
          });
        }
      }
    }
  }
  const dueDate = new Date(Date.now() + Number(settings?.default_payment_days || 30) * 86400000).toISOString().slice(0,10);
  return <><div className="pageHead"><div><p className="eyebrow">Facturation</p><h1>Créer une facture</h1><p>{orderNumber ? `Commande ${orderNumber} : prestations et marchandises livrées non encore facturées. Les marchandises ne sont proposées qu'après livraison effective.` : "Construis une facture avec une ou plusieurs prestations."}</p></div></div><div className="card"><InvoiceBuilder services={services} customers={customers} initialLines={initialLines} initialCustomerId={initialCustomerId} dueDate={dueDate} orderId={orderId} action={createInvoiceDraft}/></div></>;
}
