import { requirePermission } from "@/lib/permissions";
import { requireOrganization } from "@/lib/current-org";
import { InvoiceBuilder } from "@/components/invoice-builder";
import { createInvoiceDraft } from "@/server/actions/commercial";

export default async function NewInvoice({ searchParams }: { searchParams: Promise<{ orderId?: string }> }) {
  const params = await searchParams;
  const ctx = await requireOrganization(); await requirePermission(ctx, "billing.view");
  const { supabase, organizationId } = ctx;
  const [{ data: customers = [] }, { data: services = [] }, { data: settings }] = await Promise.all([
    supabase.from("customers").select("id,name").eq("organization_id", organizationId).eq("is_active", true).order("name"),
    supabase.from("services").select("id,name,unit_price,tax_rate").eq("organization_id", organizationId).eq("is_active", true).order("name"),
    supabase.from("company_settings").select("default_payment_days").eq("organization_id", organizationId).maybeSingle(),
  ]);
  const orderId = params.orderId?.trim() || null;
  let initialCustomerId: string | undefined;
  let initialLines: { service_id: string; quantity: number; discount_pct: number; unit_price?: number; order_line_id?: string; tax_rate?: number }[] = [];
  let orderNumber = "";
  if (orderId) {
    const [{ data: order }, { data: orderLines = [] }] = await Promise.all([
      supabase.from("orders").select("id,number,customer_id,status").eq("organization_id", organizationId).eq("id", orderId).maybeSingle(),
      supabase.from("order_lines").select("id,service_id,quantity,unit_price,tax_rate,discount_pct").eq("organization_id", organizationId).eq("order_id", orderId).order("sort_order"),
    ]);
    if (order && ["confirmed", "in_progress", "completed"].includes(order.status)) {
      initialCustomerId = order.customer_id; orderNumber = order.number;
      initialLines = orderLines.filter((l:any)=>l.service_id).map((l:any)=>({service_id:l.service_id,quantity:Number(l.quantity),discount_pct:Number(l.discount_pct||0),unit_price:Number(l.unit_price),tax_rate:Number(l.tax_rate),order_line_id:l.id}));
    }
  }
  const dueDate = new Date(Date.now() + Number(settings?.default_payment_days || 30) * 86400000).toISOString().slice(0,10);
  return <><div className="pageHead"><div><p className="eyebrow">Facturation</p><h1>Créer une facture</h1><p>{orderNumber ? `À partir de la commande ${orderNumber}. Les prestations sont préremplies et restent modifiables avant l'enregistrement du brouillon.` : "Construis la facture avec une ou plusieurs prestations avant de créer le brouillon."}</p></div></div><div className="card"><InvoiceBuilder services={services} customers={customers} initialLines={initialLines} initialCustomerId={initialCustomerId} dueDate={dueDate} orderId={orderId} action={createInvoiceDraft}/></div></>;
}
