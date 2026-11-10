"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrganization } from "@/lib/current-org";
import { assertPermission } from "@/lib/permissions";

const lineSchema = z.object({
  item_id: z.string().uuid(),
  description: z.string().trim().min(2).max(240),
  purchase_purpose: z.enum(["resale","customer_mandate","company_use","consumption"]),
  beneficiary_customer_id: z.string().uuid().nullable().optional(),
  mandate_confirmed: z.boolean().default(false),
  supplier_document_names_customer: z.boolean().default(false),
  company_bears_goods_risk: z.boolean().default(true),
  exact_cost_supported: z.boolean().default(false),
  mandate_supplier_document_reference: z.string().trim().max(160).nullable().optional(),
  quantity_ordered: z.number().finite().positive(),
  unit: z.string().trim().min(1).max(24),
  unit_price: z.number().finite().nonnegative(),
  tax_rate: z.number().finite().min(0).max(100),
  stock_location_id: z.string().uuid().nullable().optional(),
}).superRefine((line,ctx)=>{
  if(line.purchase_purpose==="customer_mandate"){
    if(!line.beneficiary_customer_id) ctx.addIssue({code:"custom",path:["beneficiary_customer_id"],message:"Le client bénéficiaire est obligatoire pour un mandat."});
    if(!line.mandate_confirmed || !line.supplier_document_names_customer || line.company_bears_goods_risk || !line.exact_cost_supported || !line.mandate_supplier_document_reference?.trim()){
      ctx.addIssue({code:"custom",message:"Le mandat exige autorisation, facture fournisseur au nom du client, absence de risque porté par l'entreprise et justificatif du coût exact."});
    }
  } else if(line.beneficiary_customer_id){
    ctx.addIssue({code:"custom",path:["beneficiary_customer_id"],message:"Le bénéficiaire n'est admis que pour un achat sous mandat."});
  }
});

export async function createPurchaseOrder(formData: FormData) {
  const ctx=await requireOrganization();
  await assertPermission(ctx,"inventory.manage");
  const supplierId=z.string().uuid().parse(formData.get("supplier_id"));
  const currency=z.string().trim().length(3).parse(formData.get("currency")||"MGA").toUpperCase();
  const expectedDate=z.preprocess(v=>v===""?null:v,z.string().date().nullable()).parse(formData.get("expected_date"));
  const notes=z.string().trim().max(2000).parse(formData.get("notes")||"");
  let raw: unknown;
  try { raw=JSON.parse(String(formData.get("lines_json")||"[]")); } catch { throw new Error("Les lignes de commande sont invalides."); }
  const lines=z.array(lineSchema).min(1).max(100).parse(raw);
  const {data:supplier,error:supplierError}=await ctx.supabase.from("suppliers").select("id").eq("id",supplierId).eq("organization_id",ctx.organizationId).maybeSingle();
  if(supplierError||!supplier) throw new Error("Fournisseur introuvable dans cette entreprise.");
  const itemIds=[...new Set(lines.map(l=>l.item_id))];
  const {data:items,error:itemError}=await ctx.supabase.from("catalog_items").select("id,name,base_unit,tracking_mode,is_active").eq("organization_id",ctx.organizationId).in("id",itemIds);
  if(itemError||!items||items.length!==itemIds.length||items.some((i:any)=>!i.is_active)) throw new Error("Un ou plusieurs articles sont absents, archivés ou hors de cette entreprise.");
  const customerIds=[...new Set(lines.flatMap(l=>l.beneficiary_customer_id?[l.beneficiary_customer_id]:[]))];
  if(customerIds.length){
    const {data:customers,error}=await ctx.supabase.from("customers").select("id").eq("organization_id",ctx.organizationId).in("id",customerIds);
    if(error||!customers||customers.length!==customerIds.length) throw new Error("Un client bénéficiaire est introuvable dans cette entreprise.");
  }
  const itemById=new Map(items.map((i:any)=>[i.id,i]));
  for(const line of lines){
    const item:any=itemById.get(line.item_id);
    if(line.purchase_purpose==="resale" && item.tracking_mode!=="quantity") throw new Error("Un article destiné à la revente doit être suivi en quantité.");
    if(item.tracking_mode==="serial") throw new Error("Le suivi par numéro de série n'est pas encore pris en charge.");
    if(line.stock_location_id){
      const {data:loc,error}=await ctx.supabase.from("stock_locations").select("id").eq("id",line.stock_location_id).eq("organization_id",ctx.organizationId).eq("is_active",true).maybeSingle();
      if(error||!loc) throw new Error("Emplacement de stock invalide.");
    }
  }
  const subtotal=lines.reduce((s,l)=>s+l.quantity_ordered*l.unit_price,0);
  const taxTotal=lines.reduce((s,l)=>s+l.quantity_ordered*l.unit_price*l.tax_rate/100,0);
  const number="PO-"+new Date().toISOString().slice(0,10).replaceAll("-","")+"-"+randomUUID().slice(0,8).toUpperCase();
  const {data:order,error:orderError}=await ctx.supabase.from("purchase_orders").insert({
    organization_id:ctx.organizationId,supplier_id:supplierId,number,status:"draft",
    expected_date:expectedDate,currency,subtotal,tax_total:taxTotal,total:subtotal+taxTotal,notes:notes||null,
  }).select("id").single();
  if(orderError||!order) throw new Error("Impossible de créer la commande fournisseur.");
  const payload=lines.map((l,index)=>({
    organization_id:ctx.organizationId,purchase_order_id:order.id,item_id:l.item_id,
    description:l.description,purchase_purpose:l.purchase_purpose,
    beneficiary_customer_id:l.beneficiary_customer_id||null,
    mandate_confirmed:l.mandate_confirmed,supplier_document_names_customer:l.supplier_document_names_customer,
    company_bears_goods_risk:l.company_bears_goods_risk,exact_cost_supported:l.exact_cost_supported,
    mandate_supplier_document_reference:l.mandate_supplier_document_reference||null,
    quantity_ordered:l.quantity_ordered,unit:l.unit,unit_price:l.unit_price,
    tax_rate:l.tax_rate,line_total:l.quantity_ordered*l.unit_price*(1+l.tax_rate/100),sort_order:index,
    stock_location_id:l.stock_location_id||null,
  }));
  const {error:lineError}=await ctx.supabase.from("purchase_order_lines").insert(payload);
  if(lineError){
    await ctx.supabase.from("purchase_orders").delete().eq("id",order.id).eq("organization_id",ctx.organizationId);
    throw new Error("Impossible d'enregistrer les lignes de commande.");
  }
  const {error:submitError}=await ctx.supabase.from("purchase_orders").update({status:"submitted"}).eq("id",order.id).eq("organization_id",ctx.organizationId).eq("status","draft");
  if(submitError) throw new Error("Commande créée en brouillon mais sa soumission a échoué. Recharge la page avant toute nouvelle tentative.");
  revalidatePath("/approvisionnements");
}

export async function postPurchaseReceipt(formData: FormData) {
  const ctx=await requireOrganization();
  await assertPermission(ctx,"inventory.manage");
  const orderId=z.string().uuid().parse(formData.get("purchase_order_id"));
  const orderLineId=z.string().uuid().parse(formData.get("purchase_order_line_id"));
  const locationId=z.preprocess(v=>v===""?null:v,z.string().uuid().nullable()).parse(formData.get("stock_location_id"));
  const quantity=z.coerce.number().finite().positive().parse(formData.get("quantity_received"));
  const unitCost=z.coerce.number().finite().nonnegative().parse(formData.get("unit_cost"));
  const reference=z.string().trim().max(160).parse(formData.get("supplier_delivery_reference")||"");
  const receivedAt=z.string().datetime({offset:true}).optional().parse(formData.get("received_at")||undefined);
  const {data:order,error:orderError}=await ctx.supabase.from("purchase_orders").select("id,currency,status").eq("id",orderId).eq("organization_id",ctx.organizationId).maybeSingle();
  if(orderError||!order||!["submitted","partially_received"].includes(order.status)) throw new Error("Commande introuvable ou non ouverte à la réception.");
  const {data:line,error:lineError}=await ctx.supabase.from("purchase_order_lines").select("id,item_id,purchase_purpose,quantity_ordered,quantity_received").eq("id",orderLineId).eq("purchase_order_id",orderId).eq("organization_id",ctx.organizationId).maybeSingle();
  if(lineError||!line) throw new Error("Ligne de commande introuvable.");
  if(Number(line.quantity_received)+quantity>Number(line.quantity_ordered)+1e-8) throw new Error("La quantité dépasse le reliquat à recevoir.");
  const targetLocation=locationId;
  if(line.purchase_purpose!=="customer_mandate" && !targetLocation) throw new Error("Un emplacement est obligatoire pour une réception appartenant à l'entreprise.");
  const receiptId=randomUUID();
  const receiptNumber="GR-"+new Date().toISOString().slice(0,10).replaceAll("-","")+"-"+receiptId.slice(0,8).toUpperCase();
  const {error:receiptError}=await ctx.supabase.from("goods_receipts").insert({
    id:receiptId,organization_id:ctx.organizationId,purchase_order_id:orderId,receipt_number:receiptNumber,
    status:"draft",received_at:receivedAt||new Date().toISOString(),supplier_delivery_reference:reference||null,
  });
  if(receiptError) throw new Error("Impossible de créer le bon de réception.");
  const {error:receiptLineError}=await ctx.supabase.from("goods_receipt_lines").insert({
    organization_id:ctx.organizationId,goods_receipt_id:receiptId,purchase_order_line_id:orderLineId,
    stock_location_id:targetLocation,quantity_received:quantity,unit_cost:unitCost,
  });
  if(receiptLineError) throw new Error("Bon de réception créé en brouillon, mais sa ligne n'a pas été enregistrée.");
  const {error:postingError}=await ctx.supabase.rpc("post_goods_receipt",{p_receipt_id:receiptId});
  if(postingError) throw new Error("Réception conservée en brouillon, non validée : "+postingError.message);
  revalidatePath("/approvisionnements");
  revalidatePath("/articles");
}

export async function cancelDraftPurchaseOrder(formData: FormData) {
  const ctx=await requireOrganization();
  await assertPermission(ctx,"inventory.manage");
  const id=z.string().uuid().parse(formData.get("purchase_order_id"));
  const {data,error}=await ctx.supabase.from("purchase_orders").update({status:"cancelled"})
    .eq("id",id).eq("organization_id",ctx.organizationId).eq("status","draft").select("id").maybeSingle();
  if(error||!data) throw new Error("Seule une commande brouillon peut être annulée.");
  revalidatePath("/approvisionnements");
}
