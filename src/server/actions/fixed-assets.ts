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
  in_service_date: z.string().date().optional(),
  acquisition_cost: z.coerce.number().finite().positive(),
  directly_attributable_cost: z.coerce.number().finite().nonnegative().default(0),
  residual_value: z.coerce.number().finite().nonnegative().default(0),
  useful_life_months: z.preprocess((value) => value === "" || value == null ? undefined : value, z.coerce.number().int().positive().optional()),
  depreciation_method: z.enum(["straight_line", "none"]),
    pcg_asset_account_code: z.string().trim().regex(/^(20|21|22(?!9)|23|26|27)\d{0,4}$/),
    pcg_acquisition_counterpart_account_code: z.string().trim().regex(/^(10|4|5|72)\d{0,4}$/),
  pcg_accumulated_depreciation_account_code: z.string().trim().optional(),
  pcg_depreciation_expense_account_code: z.string().trim().optional(),
  pcg_impairment_account_code: z.string().trim().regex(/^29\d{0,4}$/),
  pcg_impairment_expense_account_code: z.string().trim().regex(/^68\d{0,4}$/),
  pcg_impairment_reversal_income_account_code: z.string().trim().regex(/^78\d{0,4}$/),
  pcg_disposal_receivable_account_code: z.string().trim().regex(/^46\d{0,4}$/),
  pcg_disposal_expense_account_code: z.string().trim().regex(/^65\d{0,4}$/),
  pcg_disposal_income_account_code: z.string().trim().regex(/^75\d{0,4}$/),
  supplier_name: z.string().trim().max(180).optional(),
  invoice_reference: z.string().trim().max(100).optional(),
  serial_number: z.string().trim().max(120).optional(),
  location: z.string().trim().max(180).optional(),
  custodian: z.string().trim().max(180).optional(),
  notes: z.string().trim().max(2000).optional(),
}).superRefine((value, ctx) => {
  const classRules: Array<[string, string | undefined, RegExp, string]> = [
    ["pcg_impairment_account_code", value.pcg_impairment_account_code, /^29\d{0,4}$/, "Le compte de dépréciation doit appartenir à la classe 29."],
    ["pcg_impairment_expense_account_code", value.pcg_impairment_expense_account_code, /^68\d{0,4}$/, "Le compte de dotation pour dépréciation doit appartenir à la classe 68."],
    ["pcg_impairment_reversal_income_account_code", value.pcg_impairment_reversal_income_account_code, /^78\d{0,4}$/, "Le compte de reprise doit appartenir à la classe 78."],
    ["pcg_disposal_receivable_account_code", value.pcg_disposal_receivable_account_code, /^46\d{0,4}$/, "Le compte de créance de cession doit appartenir à la classe 46."],
    ["pcg_disposal_expense_account_code", value.pcg_disposal_expense_account_code, /^65\d{0,4}$/, "Le compte de moins-value doit appartenir à la classe 65."],
    ["pcg_disposal_income_account_code", value.pcg_disposal_income_account_code, /^75\d{0,4}$/, "Le compte de plus-value doit appartenir à la classe 75."],
  ];
  for (const [field, code, pattern, message] of classRules) {
    if (code && !pattern.test(code)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message });
  }
  const assetFamily = value.pcg_asset_account_code.slice(0, 2);
  const impairmentFamily: Record<string, string> = { "20": "290", "21": "291", "22": "292", "23": "293", "26": "296", "27": "297" };
  if (!value.pcg_impairment_account_code.startsWith(impairmentFamily[assetFamily] || "invalid")) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["pcg_impairment_account_code"], message: "Le compte 29 doit correspondre à la famille de l'immobilisation." });
  }
  const isWorkInProgress = value.pcg_asset_account_code.startsWith("23");
  if (isWorkInProgress && value.in_service_date) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["in_service_date"], message: "Une immobilisation en cours ne reçoit sa date de mise en service qu'après son achèvement." });
  }
  if (isWorkInProgress && value.depreciation_method !== "none") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["depreciation_method"], message: "Une immobilisation en cours de classe 23 ne peut pas être amortie avant sa mise en service." });
  }
  if (!isWorkInProgress && !value.in_service_date) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["in_service_date"], message: "La date de mise en service est obligatoire hors compte 23." });
  }
  if (value.depreciation_method === "straight_line" && /^(211|23|26|27)/.test(value.pcg_asset_account_code)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["depreciation_method"], message: "Les terrains 211, immobilisations en cours 23 et immobilisations financières 26/27 ne sont pas amortis par le moteur linéaire." });
  }
  if (value.depreciation_method === "straight_line" && value.pcg_asset_account_code === "211") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["depreciation_method"], message: "Les terrains (211) ne sont pas amortis par défaut. Les aménagements doivent être suivis dans leur compte distinct." });
  }
  if (value.in_service_date && value.in_service_date < value.acquisition_date) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["in_service_date"], message: "La mise en service ne peut pas précéder l'acquisition." });
  }
  if (value.residual_value > value.acquisition_cost + value.directly_attributable_cost) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["residual_value"], message: "La valeur résiduelle dépasse le coût brut." });
  }
  if (value.depreciation_method === "straight_line") {
    if (!value.useful_life_months) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["useful_life_months"], message: "La durée d'utilisation est obligatoire pour un bien amortissable." });
    const accumulatedPrefix: Record<string, string> = { "20": "280", "21": "281", "22": "282" };
    if (!value.pcg_accumulated_depreciation_account_code?.startsWith(accumulatedPrefix[assetFamily] || "invalid")) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["pcg_accumulated_depreciation_account_code"], message: "Le compte 28 doit correspondre à la famille de l'immobilisation." });
    }
    if (!/^681\d{0,4}$/.test(value.pcg_depreciation_expense_account_code || "")) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["pcg_depreciation_expense_account_code"], message: "Renseigne un compte de dotation PCG de classe 681." });
    }
  } else {
    if (value.useful_life_months || value.pcg_accumulated_depreciation_account_code || value.pcg_depreciation_expense_account_code) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["depreciation_method"], message: "Une immobilisation sans amortissement ne doit pas recevoir de durée ni de comptes 28/68." });
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
  const optionalCodes = [
    value.pcg_accumulated_depreciation_account_code,
    value.pcg_depreciation_expense_account_code,
    value.pcg_impairment_account_code,
    value.pcg_impairment_expense_account_code,
    value.pcg_impairment_reversal_income_account_code,
    value.pcg_disposal_receivable_account_code,
    value.pcg_disposal_expense_account_code,
    value.pcg_disposal_income_account_code,
  ].filter((code): code is string => !!code);
  const requiredCodes = [value.pcg_asset_account_code, value.pcg_acquisition_counterpart_account_code, ...optionalCodes];
  const { data: pcgAccounts, error: pcgError } = await ctx.supabase
    .from("pcg2005_accounts").select("code,kind").in("code", requiredCodes);
  if (pcgError) throw new Error("Impossible de vérifier les comptes PCG.");
  const accountKinds = new Map((pcgAccounts || []).map((account: { code: string; kind: string }) => [account.code, account.kind]));
  if (accountKinds.get(value.pcg_asset_account_code) !== "asset") {
    throw new Error("Le compte d'immobilisation n'existe pas dans le plan PCG ou n'est pas classé à l'actif.");
  }
  if (!["asset", "liability", "equity", "income"].includes(accountKinds.get(value.pcg_acquisition_counterpart_account_code) || "")) {
    throw new Error("La contrepartie doit être un compte PCG autorisé : fournisseur, trésorerie, capital, associé ou production immobilisée.");
  }
  if (value.depreciation_method === "straight_line" &&
      (accountKinds.get(value.pcg_accumulated_depreciation_account_code || "") !== "asset" ||
       accountKinds.get(value.pcg_depreciation_expense_account_code || "") !== "expense")) {
    throw new Error("Les comptes d'amortissement ne correspondent pas au plan PCG chargé.");
  }
  const expectedKinds: Array<[string | undefined, string]> = [
    [value.pcg_impairment_account_code, "asset"],
    [value.pcg_impairment_expense_account_code, "expense"],
    [value.pcg_impairment_reversal_income_account_code, "income"],
    [value.pcg_disposal_receivable_account_code, "asset"],
    [value.pcg_disposal_expense_account_code, "expense"],
    [value.pcg_disposal_income_account_code, "income"],
  ];
  for (const [code, kind] of expectedKinds) {
    if (code && accountKinds.get(code) !== kind) {
      throw new Error(`Le compte PCG ${code} est absent ou son type ne correspond pas au rôle attendu.`);
    }
  }
  const usefulLife = value.depreciation_method === "straight_line" ? Number(value.useful_life_months) : null;
  const gross = Math.round((value.acquisition_cost + value.directly_attributable_cost + Number.EPSILON) * 100) / 100;
  const { error } = await ctx.supabase.from("fixed_assets").insert({
    organization_id: ctx.organizationId,
    asset_code: value.asset_code,
    name: value.name,
    category: value.category || null,
    acquisition_date: value.acquisition_date,
    in_service_date: value.in_service_date || null,
    acquisition_cost: value.acquisition_cost,
    directly_attributable_cost: value.directly_attributable_cost,
    residual_value: value.residual_value,
    useful_life_months: usefulLife,
    depreciation_method: value.depreciation_method,
    pcg_asset_account_code: value.pcg_asset_account_code,
    pcg_acquisition_counterpart_account_code: value.pcg_acquisition_counterpart_account_code,
    pcg_accumulated_depreciation_account_code: value.pcg_accumulated_depreciation_account_code || null,
    pcg_depreciation_expense_account_code: value.pcg_depreciation_expense_account_code || null,
    pcg_impairment_account_code: value.pcg_impairment_account_code || null,
    pcg_impairment_expense_account_code: value.pcg_impairment_expense_account_code || null,
    pcg_impairment_reversal_income_account_code: value.pcg_impairment_reversal_income_account_code || null,
    pcg_disposal_receivable_account_code: value.pcg_disposal_receivable_account_code || null,
    pcg_disposal_expense_account_code: value.pcg_disposal_expense_account_code || null,
    pcg_disposal_income_account_code: value.pcg_disposal_income_account_code || null,
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


const depreciationPlanSchema = z.object({
  asset_id: z.string().uuid(),
  period_start: z.string().date(),
  period_end: z.string().date(),
}).refine((v) => v.period_end >= v.period_start, { message: "La fin de période doit suivre le début." });

export async function planFixedAssetDepreciation(formData: FormData) {
  const ctx = await requireOrganization();
  await assertPermission(ctx, "accounting.manage");
  const parsed = depreciationPlanSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || "Période invalide.");
  const { data, error } = await ctx.supabase.rpc("magnisa_plan_fixed_asset_depreciation", {
    p_org: ctx.organizationId,
    p_asset: parsed.data.asset_id,
    p_period_start: parsed.data.period_start,
    p_period_end: parsed.data.period_end,
  });
  if (error) throw new Error("Impossible de préparer la dotation : " + error.message);
  revalidatePath("/immobilisations");
  return data;
}

export async function postFixedAssetDepreciation(formData: FormData) {
  const ctx = await requireOrganization();
  await assertPermission(ctx, "accounting.manage");
  const parsed = z.string().uuid().safeParse(formData.get("depreciation_entry_id"));
  if (!parsed.success) throw new Error("Plan de dotation invalide.");
  const { data, error } = await ctx.supabase.rpc("magnisa_post_fixed_asset_depreciation", {
    p_org: ctx.organizationId,
    p_depreciation_entry: parsed.data,
  });
  if (error) throw new Error("Impossible de comptabiliser la dotation : " + error.message);
  revalidatePath("/immobilisations");
  revalidatePath("/etats-financiers");
  revalidatePath("/comptabilite");
  return data;
}

const impairmentSchema = z.object({
  asset_id: z.string().uuid(),
  event_date: z.string().date(),
  recoverable_amount: z.coerce.number().finite().nonnegative(),
  reason: z.string().trim().min(10).max(1000),
});

export async function recordFixedAssetImpairment(formData: FormData) {
  const ctx = await requireOrganization();
  await assertPermission(ctx, "accounting.manage");
  const parsed = impairmentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || "Données de dépréciation invalides.");
  const { data, error } = await ctx.supabase.rpc("magnisa_record_fixed_asset_impairment", {
    p_org: ctx.organizationId, p_asset: parsed.data.asset_id, p_date: parsed.data.event_date,
    p_recoverable_amount: parsed.data.recoverable_amount, p_reason: parsed.data.reason,
  });
  if (error) throw new Error("Impossible de comptabiliser la dépréciation : " + error.message);
  revalidatePath("/immobilisations");
  revalidatePath("/etats-financiers");
  return data;
}

const impairmentReversalSchema = z.object({
  impairment_id: z.string().uuid(),
  event_date: z.string().date(),
  reason: z.string().trim().min(10).max(1000),
});

export async function reverseFixedAssetImpairment(formData: FormData) {
  const ctx = await requireOrganization();
  await assertPermission(ctx, "accounting.manage");
  const parsed = impairmentReversalSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || "Données de reprise invalides.");
  const { data, error } = await ctx.supabase.rpc("magnisa_reverse_fixed_asset_impairment", {
    p_org: ctx.organizationId, p_impairment: parsed.data.impairment_id,
    p_date: parsed.data.event_date, p_reason: parsed.data.reason,
  });
  if (error) throw new Error("Impossible de comptabiliser la reprise : " + error.message);
  revalidatePath("/immobilisations");
  revalidatePath("/etats-financiers");
  return data;
}

const disposalSchema = z.object({
  asset_id: z.string().uuid(),
  disposal_date: z.string().date(),
  proceeds: z.coerce.number().finite().nonnegative(),
  reason: z.string().trim().min(5).max(1000),
});

export async function disposeFixedAsset(formData: FormData) {
  const ctx = await requireOrganization();
  await assertPermission(ctx, "accounting.manage");
  const parsed = disposalSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || "Données de sortie invalides.");
  const { data, error } = await ctx.supabase.rpc("magnisa_dispose_fixed_asset", {
    p_org: ctx.organizationId, p_asset: parsed.data.asset_id,
    p_date: parsed.data.disposal_date, p_proceeds: parsed.data.proceeds, p_reason: parsed.data.reason,
  });
  if (error) throw new Error("Impossible de comptabiliser la sortie : " + error.message);
  revalidatePath("/immobilisations");
  revalidatePath("/etats-financiers");
  revalidatePath("/comptabilite");
  return data;
}

const transferSchema = z.object({
  asset_id: z.string().uuid(),
  transfer_date: z.string().date(),
  new_location: z.string().trim().max(180).optional(),
  new_custodian: z.string().trim().max(180).optional(),
  reason: z.string().trim().min(3).max(500),
});

export async function transferFixedAsset(formData: FormData) {
  const ctx = await requireOrganization();
  await assertPermission(ctx, "accounting.manage");
  const parsed = transferSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || "Données de transfert invalides.");
  const { data, error } = await ctx.supabase.rpc("magnisa_transfer_fixed_asset", {
    p_org: ctx.organizationId, p_asset: parsed.data.asset_id, p_date: parsed.data.transfer_date,
    p_new_location: parsed.data.new_location || null, p_new_custodian: parsed.data.new_custodian || null,
    p_reason: parsed.data.reason,
  });
  if (error) throw new Error("Impossible d'enregistrer le transfert : " + error.message);
  revalidatePath("/immobilisations");
  return data;
}

const ifrsAdjustmentSchema = z.object({
  asset_id: z.string().uuid(),
  adjustment_date: z.string().date(),
  standard_reference: z.string().trim().min(2).max(40).default("IAS 16"),
  adjustment_type: z.enum(["componentization", "useful_life", "residual_value", "revaluation", "impairment", "derecognition", "other"]),
  statutory_carrying_amount: z.coerce.number().finite().nonnegative(),
  ifrs_carrying_amount: z.coerce.number().finite().nonnegative(),
  reason: z.string().trim().min(10).max(1500),
  supporting_reference: z.string().trim().max(180).optional(),
});

export async function createFixedAssetIfrsAdjustment(formData: FormData) {
  const ctx = await requireOrganization();
  await assertPermission(ctx, "accounting.manage");
  const parsed = ifrsAdjustmentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || "Ajustement IFRS invalide.");
  const { data, error } = await ctx.supabase.from("fixed_asset_ifrs_adjustments").insert({
    organization_id: ctx.organizationId,
    ...parsed.data,
    status: "draft",
    created_by: ctx.user.id,
  }).select("id").single();
  if (error) throw new Error("Impossible d'enregistrer l'ajustement IFRS : " + error.message);
  revalidatePath("/immobilisations");
  return data.id;
}

export async function approveFixedAssetIfrsAdjustment(formData: FormData) {
  const ctx = await requireOrganization();
  await assertPermission(ctx, "accounting.manage");
  const parsed = z.string().uuid().safeParse(formData.get("adjustment_id"));
  if (!parsed.success) throw new Error("Ajustement IFRS invalide.");
  const { data, error } = await ctx.supabase.rpc("magnisa_approve_fixed_asset_ifrs_adjustment", {
    p_org: ctx.organizationId, p_adjustment: parsed.data,
  });
  if (error) throw new Error("Impossible d'approuver l'ajustement IFRS : " + error.message);
  revalidatePath("/immobilisations");
  return data;
}


export async function postFixedAssetAcquisition(formData: FormData) {
  const ctx = await requireOrganization();
  await assertPermission(ctx, "accounting.manage");
  const parsed = z.string().uuid().safeParse(formData.get("asset_id"));
  if (!parsed.success) throw new Error("Immobilisation invalide.");
  const { data, error } = await ctx.supabase.rpc("magnisa_post_fixed_asset_acquisition", {
    p_org: ctx.organizationId, p_asset: parsed.data,
  });
  if (error) throw new Error("Impossible de comptabiliser l'acquisition : " + error.message);
  revalidatePath("/immobilisations");
  revalidatePath("/etats-financiers");
  revalidatePath("/comptabilite");
  return data;
}


export async function componentizeFixedAsset(formData: FormData) {
  const ctx = await requireOrganization();
  await assertPermission(ctx, "accounting.manage");
  const parsed = z.object({
    parent_asset_id: z.string().uuid(),
    event_date: z.string().date(),
    reason: z.string().trim().min(10).max(1500),
    components_json: z.string().trim().min(2).max(30000),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || "Données de ventilation invalides.");
  let components: unknown;
  try {
    components = JSON.parse(parsed.data.components_json);
  } catch {
    throw new Error("Le détail des composants doit être un JSON valide.");
  }
  if (!Array.isArray(components) || components.length < 2 || components.length > 20) {
    throw new Error("La ventilation doit contenir entre 2 et 20 composants.");
  }
  const { data, error } = await ctx.supabase.rpc("magnisa_componentize_fixed_asset", {
    p_org: ctx.organizationId,
    p_parent_asset: parsed.data.parent_asset_id,
    p_event_date: parsed.data.event_date,
    p_components: components,
    p_reason: parsed.data.reason,
  });
  if (error) throw new Error("Impossible de ventiler l'immobilisation : " + error.message);
  revalidatePath("/immobilisations");
  revalidatePath("/etats-financiers");
  revalidatePath("/comptabilite");
  return data;
}


export async function reverseFixedAssetDepreciation(formData: FormData) {
  const ctx = await requireOrganization();
  await assertPermission(ctx, "accounting.manage");
  const parsed = z.object({
    depreciation_entry_id: z.string().uuid(),
    reversal_date: z.string().date(),
    reason: z.string().trim().min(10).max(1000),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || "Données de contrepassation invalides.");
  const { data, error } = await ctx.supabase.rpc("magnisa_reverse_fixed_asset_depreciation", {
    p_org: ctx.organizationId,
    p_depreciation_entry: parsed.data.depreciation_entry_id,
    p_reversal_date: parsed.data.reversal_date,
    p_reason: parsed.data.reason,
  });
  if (error) throw new Error("Impossible de contrepasser la dotation : " + error.message);
  revalidatePath("/immobilisations");
  revalidatePath("/etats-financiers");
  revalidatePath("/comptabilite");
  return data;
}


export async function reverseFixedAssetIfrsAdjustment(formData: FormData) {
  const ctx = await requireOrganization();
  await assertPermission(ctx, "accounting.manage");
  const parsed = z.object({
    adjustment_id: z.string().uuid(),
    reason: z.string().trim().min(10).max(1000),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || "Données de contrepassation IFRS invalides.");
  const { data, error } = await ctx.supabase.rpc("magnisa_reverse_fixed_asset_ifrs_adjustment", {
    p_org: ctx.organizationId,
    p_adjustment: parsed.data.adjustment_id,
    p_reason: parsed.data.reason,
  });
  if (error) throw new Error("Impossible de contrepasser l'ajustement IFRS : " + error.message);
  revalidatePath("/immobilisations");
  revalidatePath("/etats-financiers");
  return data;
}
