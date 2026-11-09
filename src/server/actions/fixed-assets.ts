"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrganization } from "@/lib/current-org";
import { assertPermission } from "@/lib/permissions";

const assetSchema = z.object({
  asset_code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(2).max(180),
  category: z.string().trim().max(100).optional(),
  acquisition_date: z.string().date(),
  in_service_date: z.string().date(),
  acquisition_cost: z.coerce.number().finite().positive(),
  directly_attributable_cost: z.coerce.number().finite().nonnegative().default(0),
  residual_value: z.coerce.number().finite().nonnegative().default(0),
  useful_life_months: z.union([z.coerce.number().int().positive(), z.literal("")]).optional(),
  depreciation_method: z.enum(["straight_line", "none"]),
  pcg_asset_account_code: z.string().trim().regex(/^(20|21|22|23|26|27)\\d{0,4}$/),
  pcg_accumulated_depreciation_account_code: z.string().trim().optional(),
  pcg_depreciation_expense_account_code: z.string().trim().optional(),
  supplier_name: z.string().trim().max(180).optional(),
  invoice_reference: z.string().trim().max(100).optional(),
  serial_number: z.string().trim().max(120).optional(),
  location: z.string().trim().max(180).optional(),
  custodian: z.string().trim().max(180).optional(),
  notes: z.string().trim().max(2000).optional(),
}).superRefine((value, ctx) => {
  if (value.in_service_date < value.acquisition_date) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["in_service_date"], message: "La mise en service ne peut pas précéder l'acquisition." });
  }
  if (value.residual_value > value.acquisition_cost + value.directly_attributable_cost) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["residual_value"], message: "La valeur résiduelle dépasse le coût brut." });
  }
  if (value.depreciation_method === "straight_line") {
    if (!value.useful_life_months) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["useful_life_months"], message: "La durée d'utilisation est obligatoire pour un bien amortissable." });
    if (!/^28\\d{0,4}$/.test(value.pcg_accumulated_depreciation_account_code || "")) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["pcg_accumulated_depreciation_account_code"], message: "Renseigne un compte correcteur PCG de classe 28." });
    }
    if (!/^681\\d{0,4}$/.test(value.pcg_depreciation_expense_account_code || "")) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["pcg_depreciation_expense_account_code"], message: "Renseigne un compte de dotation PCG de classe 68." });
    }
  }
});

export async function createFixedAsset(formData: FormData) {
  const ctx = await requireOrganization();
  await assertPermission(ctx, "accounting.manage");
  const parsed = assetSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(issue?.message || "Les informations de l'immobilisation sont invalides.");
  }
  const value = parsed.data;
  const usefulLife = value.depreciation_method === "straight_line" ? Number(value.useful_life_months) : null;
  const gross = Math.round((value.acquisition_cost + value.directly_attributable_cost + Number.EPSILON) * 100) / 100;
  const { error } = await ctx.supabase.from("fixed_assets").insert({
    organization_id: ctx.organizationId,
    asset_code: value.asset_code,
    name: value.name,
    category: value.category || null,
    acquisition_date: value.acquisition_date,
    in_service_date: value.in_service_date,
    acquisition_cost: value.acquisition_cost,
    directly_attributable_cost: value.directly_attributable_cost,
    residual_value: value.residual_value,
    useful_life_months: usefulLife,
    depreciation_method: value.depreciation_method,
    pcg_asset_account_code: value.pcg_asset_account_code,
    pcg_accumulated_depreciation_account_code: value.pcg_accumulated_depreciation_account_code || null,
    pcg_depreciation_expense_account_code: value.pcg_depreciation_expense_account_code || null,
    supplier_name: value.supplier_name || null,
    invoice_reference: value.invoice_reference || null,
    serial_number: value.serial_number || null,
    location: value.location || null,
    custodian: value.custodian || null,
    notes: value.notes || null,
    accumulated_depreciation: 0,
    net_book_value: gross,
    status: "active",
  });
  if (error) {
    if (error.code === "23505") throw new Error("Ce code immobilisation existe déjà dans cette organisation.");
    throw new Error("Impossible d'enregistrer l'immobilisation : " + error.message);
  }
  revalidatePath("/immobilisations");
  revalidatePath("/etats-financiers");
}
