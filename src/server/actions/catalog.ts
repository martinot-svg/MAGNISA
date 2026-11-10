"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrganization } from "@/lib/current-org";
import { assertPermission } from "@/lib/permissions";

const itemSchema = z.object({
  sku: z.string().trim().min(1).max(60),
  name: z.string().trim().min(2).max(180),
  description: z.string().trim().max(1000).optional(),
  item_kind: z.enum(["merchandise","equipment","consumable","raw_material","other"]),
  base_unit: z.string().trim().min(1).max(24),
  tracking_mode: z.enum(["none","quantity"]),
  default_purchase_price: z.coerce.number().finite().nonnegative(),
  default_sale_price: z.coerce.number().finite().nonnegative(),
  default_tax_rate: z.coerce.number().finite().min(0).max(100),
});

const activeSchema = z.object({
  id: z.string().uuid(),
  is_active: z.enum(["true","false"]),
});

const locationSchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(2).max(120),
  location_kind: z.enum(["warehouse","store","transit","virtual"]),
});

export async function createCatalogItem(formData: FormData) {
  const ctx = await requireOrganization();
  await assertPermission(ctx, "inventory.manage");
  const parsed = itemSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new Error("Vérifie les informations de l'article.");
  const { error } = await ctx.supabase.from("catalog_items").insert({
    organization_id: ctx.organizationId,
    ...parsed.data,
    description: parsed.data.description || null,
  });
  if (error) {
    if (error.code === "23505") throw new Error("Ce SKU existe déjà dans cette entreprise.");
    throw new Error("Impossible de créer l'article. Vérifie les informations puis réessaie.");
  }
  revalidatePath("/articles");
}

export async function setCatalogItemActive(formData: FormData) {
  const ctx = await requireOrganization();
  await assertPermission(ctx, "inventory.manage");
  const parsed = activeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new Error("Demande de modification du statut invalide.");
  const { data, error } = await ctx.supabase.from("catalog_items")
    .update({ is_active: parsed.data.is_active === "true" })
    .eq("organization_id", ctx.organizationId)
    .eq("id", parsed.data.id)
    .select("id")
    .maybeSingle();
  if (error || !data) throw new Error("Impossible de modifier le statut de cet article.");
  revalidatePath("/articles");
}

export async function createStockLocation(formData: FormData) {
  const ctx = await requireOrganization();
  await assertPermission(ctx, "inventory.manage");
  const parsed = locationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new Error("Vérifie les informations de l'emplacement.");
  const { error } = await ctx.supabase.from("stock_locations").insert({
    organization_id: ctx.organizationId,
    ...parsed.data,
  });
  if (error) {
    if (error.code === "23505") throw new Error("Ce code d'emplacement existe déjà dans cette entreprise.");
    throw new Error("Impossible de créer l'emplacement.");
  }
  revalidatePath("/articles");
}

export async function setStockLocationActive(formData: FormData) {
  const ctx = await requireOrganization();
  await assertPermission(ctx, "inventory.manage");
  const parsed = activeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new Error("Demande de modification du statut invalide.");
  if (parsed.data.is_active === "false") {
    const { data: balances, error: balanceError } = await ctx.supabase.from("stock_on_hand")
      .select("quantity_on_hand")
      .eq("organization_id", ctx.organizationId)
      .eq("stock_location_id", parsed.data.id);
    if (balanceError) throw new Error("Impossible de vérifier le stock de cet emplacement.");
    if ((balances || []).some((row: { quantity_on_hand: number }) => Number(row.quantity_on_hand) !== 0)) {
      throw new Error("Cet emplacement contient encore du stock. Transfère ou régularise les quantités avant de l'archiver.");
    }
  }
  const { data, error } = await ctx.supabase.from("stock_locations")
    .update({ is_active: parsed.data.is_active === "true" })
    .eq("organization_id", ctx.organizationId)
    .eq("id", parsed.data.id)
    .select("id")
    .maybeSingle();
  if (error || !data) throw new Error("Impossible de modifier le statut de cet emplacement.");
  revalidatePath("/articles");
}
