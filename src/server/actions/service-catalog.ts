"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrganization } from "@/lib/current-org";
import { assertPermission } from "@/lib/permissions";
import { isBillingUnit } from "@/lib/magnisa-next/billing-units";

const serviceInput = z.object({
  name: z.string().trim().min(2).max(180),
  description: z.string().trim().max(5000).optional(),
  category_id: z.string().uuid().optional().or(z.literal("")),
  unit: z.string().trim().refine(isBillingUnit, "Unité de facturation inconnue."),
  unit_price: z.coerce.number().finite().nonnegative(),
  tax_rate: z.coerce.number().finite().min(0).max(100,
  ),
  service_type: z.enum(["one_off", "recurring"]).default("one_off"),
  recurrence_frequency: z.enum(["daily","weekly","monthly","quarterly","semiannual","annual","custom"]).optional().or(z.literal("")),
  custom_interval_days: z.coerce.number().int().min(1).max(365).optional().or(z.literal("")),
});

const uuid = z.string().uuid();

export async function createCatalogCategory(formData: FormData) {
  const ctx = await requireOrganization();
  await assertPermission(ctx, "services.create");
  const parsed = z.object({
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(2000).optional(),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new Error("Nom ou description de catégorie invalide.");
  const { data, error } = await ctx.supabase.rpc("create_service_category_with_services", {
    p_org: ctx.organizationId,
    p_category_name: parsed.data.name,
    p_category_description: parsed.data.description || null,
    p_services: [],
  });
  if (error) throw new Error("Création de catégorie impossible : " + error.message);
  revalidatePath("/services");
  return data as string;
}

export async function createCatalogService(formData: FormData) {
  const ctx = await requireOrganization();
  await assertPermission(ctx, "services.create");
  const parsed = serviceInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new Error("Vérifie les informations de la prestation et son unité.");
  const v = parsed.data;
  if (v.service_type === "recurring" && !v.recurrence_frequency) throw new Error("Choisis la fréquence de récurrence.");
  if (v.service_type === "recurring" && v.recurrence_frequency === "custom" && !v.custom_interval_days) throw new Error("Indique l'intervalle personnalisé.");
  const { error } = await ctx.supabase.rpc("create_service_catalog_item", {
    p_org: ctx.organizationId,
    p_name: v.name,
    p_description: v.description || null,
    p_category: v.category_id || null,
    p_unit: v.unit,
    p_unit_price: v.unit_price,
    p_tax_rate: v.tax_rate,
    p_service_type: v.service_type,
    p_recurrence_frequency: v.service_type === "recurring" ? v.recurrence_frequency || null : null,
    p_custom_interval_days: v.service_type === "recurring" && v.recurrence_frequency === "custom" ? Number(v.custom_interval_days) : null,
  });
  if (error) throw new Error("Création de prestation impossible : " + error.message);
  revalidatePath("/services");
}

export async function updateCatalogService(formData: FormData) {
  const ctx = await requireOrganization();
  await assertPermission(ctx, "services.create");
  const raw = Object.fromEntries(formData);
  const id = uuid.safeParse(raw.id);
  const parsed = serviceInput.safeParse(raw);
  if (!id.success || !parsed.success) throw new Error("Les informations de la prestation sont invalides.");
  const v = parsed.data;
  if (v.service_type === "recurring" && !v.recurrence_frequency) throw new Error("Choisis la fréquence de récurrence.");
  if (v.service_type === "recurring" && v.recurrence_frequency === "custom" && !v.custom_interval_days) throw new Error("Indique l'intervalle personnalisé.");
  const { error } = await ctx.supabase.rpc("update_service_catalog_item", {
    p_org: ctx.organizationId,
    p_service: id.data,
    p_name: v.name,
    p_description: v.description || null,
    p_category: v.category_id || null,
    p_unit: v.unit,
    p_unit_price: v.unit_price,
    p_tax_rate: v.tax_rate,
    p_service_type: v.service_type,
    p_recurrence_frequency: v.service_type === "recurring" ? v.recurrence_frequency || null : null,
    p_custom_interval_days: v.service_type === "recurring" && v.recurrence_frequency === "custom" ? Number(v.custom_interval_days) : null,
  });
  if (error) throw new Error("Modification impossible : " + error.message);
  revalidatePath("/services");
}
