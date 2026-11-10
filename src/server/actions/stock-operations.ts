"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireOrganization } from "@/lib/current-org";
import { assertPermission } from "@/lib/permissions";

export async function addCatalogItemToOrderAction(formData: FormData) {
  const ctx=await requireOrganization();
  await assertPermission(ctx,"orders.manage");
  const orderId=z.string().uuid().parse(formData.get("order_id"));
  const itemId=z.string().uuid().parse(formData.get("item_id"));
  const quantity=z.coerce.number().finite().positive().parse(formData.get("quantity"));
  const unitPrice=z.coerce.number().finite().nonnegative().parse(formData.get("unit_price"));
  const taxRate=z.coerce.number().finite().min(0).max(100).parse(formData.get("tax_rate"));
  const discountPct=z.coerce.number().finite().min(0).max(100).parse(formData.get("discount_pct")||0);
  const {data,error}=await ctx.supabase.rpc("add_catalog_item_to_order",{
    p_organization_id:ctx.organizationId,p_order_id:orderId,p_item_id:itemId,p_quantity:quantity,
    p_unit_price:unitPrice,p_tax_rate:taxRate,p_discount_pct:discountPct,
  });
  if(error) throw new Error("Article non ajouté à la commande : "+error.message);
  if(!data) throw new Error("La base n'a retourné aucun identifiant de ligne.");
  revalidatePath("/commandes");revalidatePath("/factures");
}

export async function reserveStockAction(formData: FormData) {
  const ctx=await requireOrganization();
  await assertPermission(ctx,"orders.manage");
  const input={
    orderId:z.string().uuid().parse(formData.get("order_id")),
    orderLineId:z.string().uuid().parse(formData.get("order_line_id")),
    itemId:z.string().uuid().parse(formData.get("item_id")),
    locationId:z.string().uuid().parse(formData.get("stock_location_id")),
    quantity:z.coerce.number().finite().positive().parse(formData.get("quantity")),
    requestKey:z.string().uuid().parse(formData.get("request_key")),
  };
  const {error}=await ctx.supabase.rpc("reserve_stock",{
    p_organization_id:ctx.organizationId,p_order_id:input.orderId,p_order_line_id:input.orderLineId,
    p_item_id:input.itemId,p_stock_location_id:input.locationId,p_quantity:input.quantity,p_request_key:input.requestKey,
  });
  if(error) throw new Error("Réservation refusée : "+error.message);
  revalidatePath("/commandes");revalidatePath("/mouvements-stock");
}

export async function releaseStockReservationAction(formData: FormData) {
  const ctx=await requireOrganization();
  await assertPermission(ctx,"orders.manage");
  const id=z.string().uuid().parse(formData.get("reservation_id"));
  const quantity=z.coerce.number().finite().positive().parse(formData.get("quantity"));
  const requestKey=z.string().uuid().parse(formData.get("request_key"));
  const {error}=await ctx.supabase.rpc("release_stock_reservation",{
    p_organization_id:ctx.organizationId,p_reservation_id:id,p_quantity:quantity,p_request_key:requestKey,
  });
  if(error) throw new Error("Libération refusée : "+error.message);
  revalidatePath("/commandes");revalidatePath("/mouvements-stock");
}

export async function postSalesDeliveryAction(formData: FormData) {
  const ctx=await requireOrganization();
  await assertPermission(ctx,"orders.manage");
  const orderId=z.string().uuid().parse(formData.get("order_id"));
  const orderLineId=z.string().uuid().parse(formData.get("order_line_id"));
  const itemId=z.string().uuid().parse(formData.get("item_id"));
  let locationId=z.string().uuid().parse(formData.get("stock_location_id"));
  const quantity=z.coerce.number().finite().positive().parse(formData.get("quantity"));
  const reservationId=z.preprocess(v=>v===""||v==null?null:v,z.string().uuid().nullable()).parse(formData.get("reservation_id"));
  if(reservationId){
    const {data:reservation,error:reservationError}=await ctx.supabase.from("stock_reservations")
      .select("stock_location_id").eq("id",reservationId).eq("organization_id",ctx.organizationId).maybeSingle();
    if(reservationError||!reservation) throw new Error("Réservation introuvable dans cette entreprise.");
    // A delivery linked to a reservation must leave the exact reserved location.
    locationId=z.string().uuid().parse(reservation.stock_location_id);
  }
  const requestKey=z.string().uuid().parse(formData.get("request_key"));
  const reference=z.string().trim().max(160).parse(formData.get("delivery_reference")||"");
  const lines=[{order_line_id:orderLineId,item_id:itemId,stock_location_id:locationId,quantity,reservation_id:reservationId}];
  const {data,error}=await ctx.supabase.rpc("post_sales_delivery",{
    p_organization_id:ctx.organizationId,p_order_id:orderId,p_lines:lines,p_request_key:requestKey,p_delivery_reference:reference||null,
  });
  if(error) throw new Error("Livraison non validée : "+error.message);
  if(!data) throw new Error("La base n'a retourné aucun identifiant de livraison.");
  revalidatePath("/commandes");revalidatePath("/articles");revalidatePath("/mouvements-stock");
}

export async function postStockTransferAction(formData: FormData) {
  const ctx=await requireOrganization();
  await assertPermission(ctx,"inventory.manage");
  const source=z.string().uuid().parse(formData.get("source_location_id"));
  const destination=z.string().uuid().parse(formData.get("destination_location_id"));
  const item=z.string().uuid().parse(formData.get("item_id"));
  const quantity=z.coerce.number().finite().positive().parse(formData.get("quantity"));
  const stockBucket=z.enum(["resale","company_use","consumption","quarantine"]).parse(formData.get("stock_bucket")||"resale");
  const reason=z.string().trim().min(3).max(500).parse(formData.get("reason"));
  const requestKey=z.string().uuid().parse(formData.get("request_key"));
  const {data,error}=await ctx.supabase.rpc("post_stock_transfer",{
    p_organization_id:ctx.organizationId,p_source_location:source,p_destination_location:destination,
    p_lines:[{item_id:item,stock_bucket:stockBucket,quantity}],p_request_key:requestKey,p_reason:reason,
  });
  if(error) throw new Error("Transfert non validé : "+error.message);
  if(!data) throw new Error("La base n'a retourné aucun identifiant de transfert.");
  revalidatePath("/articles");revalidatePath("/mouvements-stock");revalidatePath("/commandes");
}

export async function processStockAccountingEventAction(formData: FormData) {
  const ctx=await requireOrganization();
  await assertPermission(ctx,"accounting.manage");
  const eventId=z.string().uuid().parse(formData.get("event_id"));
  const {data,error}=await ctx.supabase.rpc("process_stock_accounting_event",{
    p_organization_id:ctx.organizationId,p_event_id:eventId,
  });
  if(error) throw new Error("Événement comptable non traité : "+error.message);
  revalidatePath("/mouvements-stock");revalidatePath("/comptabilite/journaux");
}

export async function postCustomerStockReturnAction(formData:FormData){
 const ctx=await requireOrganization();await assertPermission(ctx,"inventory.manage");
 const parsed=z.object({delivery_line_id:z.string().uuid(),stock_location_id:z.string().uuid(),quantity:z.coerce.number().finite().positive(),
  return_condition:z.enum(["resalable","quarantine","damaged"]),request_key:z.string().uuid(),reason:z.string().trim().min(3).max(500)}).parse({
  delivery_line_id:formData.get("delivery_line_id"),stock_location_id:formData.get("stock_location_id"),quantity:formData.get("quantity"),
  return_condition:formData.get("return_condition"),request_key:formData.get("request_key"),reason:formData.get("reason")});
 const {error}=await ctx.supabase.rpc("post_customer_stock_return",{p_org:ctx.organizationId,p_delivery_line_id:parsed.delivery_line_id,
  p_location_id:parsed.stock_location_id,p_quantity:parsed.quantity,p_condition:parsed.return_condition,p_request_key:parsed.request_key,p_reason:parsed.reason});
 if(error)throw new Error("Retour client non enregistré : "+error.message);
 revalidatePath("/mouvements-stock");revalidatePath("/articles");
}
export async function postSupplierStockReturnAction(formData:FormData){
 const ctx=await requireOrganization();await assertPermission(ctx,"inventory.manage");
 const parsed=z.object({receipt_line_id:z.string().uuid(),stock_location_id:z.string().uuid(),quantity:z.coerce.number().finite().positive(),request_key:z.string().uuid(),reason:z.string().trim().min(3).max(500)}).parse({
  receipt_line_id:formData.get("receipt_line_id"),stock_location_id:formData.get("stock_location_id"),quantity:formData.get("quantity"),request_key:formData.get("request_key"),reason:formData.get("reason")});
 const {error}=await ctx.supabase.rpc("post_supplier_stock_return",{p_org:ctx.organizationId,p_receipt_line_id:parsed.receipt_line_id,
  p_location_id:parsed.stock_location_id,p_quantity:parsed.quantity,p_request_key:parsed.request_key,p_reason:parsed.reason});
 if(error)throw new Error("Retour fournisseur non enregistré : "+error.message);
 revalidatePath("/mouvements-stock");revalidatePath("/articles");
}
export async function postStockAdjustmentAction(formData:FormData){
 const ctx=await requireOrganization();await assertPermission(ctx,"inventory.manage");
 const parsed=z.object({item_id:z.string().uuid(),stock_location_id:z.string().uuid(),stock_bucket:z.enum(["resale","company_use","consumption","quarantine"]),
  quantity_delta:z.coerce.number().finite().refine(v=>v!==0),unit_cost:z.coerce.number().finite().nonnegative().default(0),
  reason:z.string().trim().min(3).max(500),evidence_reference:z.string().trim().max(240).optional(),request_key:z.string().uuid()}).parse({
  item_id:formData.get("item_id"),stock_location_id:formData.get("stock_location_id"),stock_bucket:formData.get("stock_bucket"),
  quantity_delta:formData.get("quantity_delta"),unit_cost:formData.get("unit_cost")||0,reason:formData.get("reason"),evidence_reference:formData.get("evidence_reference")||"",request_key:formData.get("request_key")});
 const {error}=await ctx.supabase.rpc("post_stock_adjustment",{p_org:ctx.organizationId,p_item_id:parsed.item_id,p_location_id:parsed.stock_location_id,
  p_stock_bucket:parsed.stock_bucket,p_quantity_delta:parsed.quantity_delta,p_unit_cost:parsed.unit_cost,p_reason:parsed.reason,
  p_evidence_reference:parsed.evidence_reference||null,p_request_key:parsed.request_key});
 if(error)throw new Error("Correction de stock non enregistrée : "+error.message);
 revalidatePath("/mouvements-stock");revalidatePath("/articles");
}
export async function cancelStockTransferAction(formData:FormData){
 const ctx=await requireOrganization();await assertPermission(ctx,"inventory.manage");
 const transferId=z.string().uuid().parse(formData.get("transfer_id"));const requestKey=z.string().uuid().parse(formData.get("request_key"));const reason=z.string().trim().min(3).max(500).parse(formData.get("reason"));
 const {error}=await ctx.supabase.rpc("cancel_stock_transfer",{p_org:ctx.organizationId,p_transfer_id:transferId,p_request_key:requestKey,p_reason:reason});
 if(error)throw new Error("Annulation du transfert refusée : "+error.message);
 revalidatePath("/mouvements-stock");revalidatePath("/articles");
}
export async function cancelSalesDeliveryAction(formData:FormData){
 const ctx=await requireOrganization();await assertPermission(ctx,"inventory.manage");
 const deliveryId=z.string().uuid().parse(formData.get("delivery_id"));const requestKey=z.string().uuid().parse(formData.get("request_key"));const reason=z.string().trim().min(3).max(500).parse(formData.get("reason"));
 const {error}=await ctx.supabase.rpc("cancel_sales_delivery",{p_org:ctx.organizationId,p_delivery_id:deliveryId,p_request_key:requestKey,p_reason:reason});
 if(error)throw new Error("Annulation de livraison refusée : "+error.message);
 revalidatePath("/mouvements-stock");revalidatePath("/commandes");revalidatePath("/articles");
}
