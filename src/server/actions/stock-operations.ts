"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
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
  const locationId=z.string().uuid().parse(formData.get("stock_location_id"));
  const quantity=z.coerce.number().finite().positive().parse(formData.get("quantity"));
  const unitCost=z.coerce.number().finite().nonnegative().parse(formData.get("unit_cost")||0);
  const reservationId=z.preprocess(v=>v===""||v==null?null:v,z.string().uuid().nullable()).parse(formData.get("reservation_id"));
  const requestKey=z.string().uuid().parse(formData.get("request_key"));
  const reference=z.string().trim().max(160).parse(formData.get("delivery_reference")||"");
  const lines=[{order_line_id:orderLineId,item_id:itemId,stock_location_id:locationId,quantity,unit_cost:unitCost,reservation_id:reservationId}];
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
  const unitCost=z.coerce.number().finite().nonnegative().parse(formData.get("unit_cost")||0);
  const reason=z.string().trim().min(3).max(500).parse(formData.get("reason"));
  const requestKey=z.string().uuid().parse(formData.get("request_key"));
  const {data,error}=await ctx.supabase.rpc("post_stock_transfer",{
    p_organization_id:ctx.organizationId,p_source_location:source,p_destination_location:destination,
    p_lines:[{item_id:item,quantity,unit_cost:unitCost}],p_request_key:requestKey,p_reason:reason,
  });
  if(error) throw new Error("Transfert non validé : "+error.message);
  if(!data) throw new Error("La base n'a retourné aucun identifiant de transfert.");
  revalidatePath("/articles");revalidatePath("/mouvements-stock");revalidatePath("/commandes");
}
