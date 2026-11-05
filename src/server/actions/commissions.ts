"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrganization } from "@/lib/current-org";
import { assertPermission } from "@/lib/permissions";

const prospectSchema = z.object({
  name: z.string().trim().min(2).max(180),
  email: z.string().trim().email().optional().or(z.literal("")),
  phone: z.string().trim().max(80).optional(),
  source: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(1000).optional(),
});

export async function createProspectWithOriginator(formData: FormData) {
  const ctx = await requireOrganization();
  await assertPermission(ctx, "commissions.contribute");
  const parsed = prospectSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new Error("Vérifie les informations du prospect.");
  const { error } = await ctx.supabase.rpc("create_prospect_with_originator", {
    p_org: ctx.organizationId,
    p_name: parsed.data.name,
    p_email: parsed.data.email || null,
    p_phone: parsed.data.phone || null,
    p_source: parsed.data.source || null,
    p_notes: parsed.data.notes || null,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/prospects");
  revalidatePath("/commissions");
}

const contributionSchema = z.object({
  prospect_id: z.string().uuid(),
  contribution_type: z.enum(["originator", "qualifier", "negotiator", "closer"]),
  notes: z.string().trim().max(1000).optional(),
});

export async function addProspectContributor(formData: FormData) {
  const ctx = await requireOrganization();
  await assertPermission(ctx, "commissions.contribute");
  const parsed = contributionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new Error("Informations de contribution invalides.");
  const { error } = await ctx.supabase.from("prospect_contributors").insert({
    organization_id: ctx.organizationId,
    prospect_id: parsed.data.prospect_id,
    user_id: ctx.user.id,
    created_by: ctx.user.id,
    contribution_type: parsed.data.contribution_type,
    notes: parsed.data.notes || null,
  });
  if (error) {
    if (error.code === "23505") throw new Error("Cette contribution est déjà enregistrée.");
    throw new Error("Impossible d'enregistrer la contribution. Vérifie le prospect et tes droits.");
  }
  revalidatePath("/commissions");
  revalidatePath("/prospects");
}

const policySchema = z.object({
  id: z.string().uuid().optional().or(z.literal("")),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).optional(),
  is_active: z.enum(["on", "true", "false"]).optional(),
  effective_from: z.string().date(),
  effective_until: z.string().date().optional().or(z.literal("")),
  calculation_basis: z.enum(["order_total", "invoice_paid_amount", "fixed_amount"]),
  commission_rate: z.coerce.number().positive().max(100),
  fixed_basis_amount: z.coerce.number().positive().optional().or(z.literal("")),
  currency: z.string().regex(/^[A-Z]{3}$/),
  originator: z.coerce.number().positive().max(100).optional().or(z.literal("")),
  qualifier: z.coerce.number().positive().max(100).optional().or(z.literal("")),
  negotiator: z.coerce.number().positive().max(100).optional().or(z.literal("")),
  closer: z.coerce.number().positive().max(100).optional().or(z.literal("")),
});

export async function saveCommissionPolicy(formData: FormData) {
  const ctx = await requireOrganization();
  await assertPermission(ctx, "commissions.policy.manage");
  const parsed = policySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new Error("Vérifie les paramètres de la politique de prime.");
  const v = parsed.data;
  if (v.calculation_basis === "fixed_amount" && !v.fixed_basis_amount) {
    throw new Error("Le montant de base fixe est obligatoire pour cette politique.");
  }
  if (v.calculation_basis !== "fixed_amount" && v.fixed_basis_amount !== undefined && v.fixed_basis_amount !== "") {
    throw new Error("Le montant fixe ne s'applique qu'à une politique à base fixe.");
  }
  const rules: { contribution_type: string; share_percentage: number }[] = [];
  if (typeof v.originator === "number") rules.push({ contribution_type: "originator", share_percentage: v.originator });
  if (typeof v.qualifier === "number") rules.push({ contribution_type: "qualifier", share_percentage: v.qualifier });
  if (typeof v.negotiator === "number") rules.push({ contribution_type: "negotiator", share_percentage: v.negotiator });
  if (typeof v.closer === "number") rules.push({ contribution_type: "closer", share_percentage: v.closer });
  const total = rules.reduce((sum, rule) => sum + rule.share_percentage, 0);
  if (!rules.length || Math.round(total * 100) !== 10000) {
    throw new Error("Les pourcentages de répartition doivent totaliser exactement 100 %.");
  }
  const { error } = await ctx.supabase.rpc("save_commission_policy", {
    p_org: ctx.organizationId,
    p_policy: v.id || null,
    p_name: v.name,
    p_description: v.description || null,
    p_active: v.is_active === "on" || v.is_active === "true",
    p_effective_from: v.effective_from,
    p_effective_until: v.effective_until || null,
    p_basis: v.calculation_basis,
    p_rate: v.commission_rate,
    p_fixed_basis_amount: v.calculation_basis === "fixed_amount" ? Number(v.fixed_basis_amount) : null,
    p_currency: v.currency,
    p_rules: rules,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/commissions");
}

const calculateSchema = z.object({
  prospect_id: z.string().uuid(),
  policy_id: z.string().uuid(),
  source_document_type: z.enum(["order", "invoice"]).optional().or(z.literal("")),
  source_document_id: z.string().uuid().optional().or(z.literal("")),
});

export async function calculateProspectCommission(formData: FormData) {
  const ctx = await requireOrganization();
  await assertPermission(ctx, "commissions.calculate");
  const parsed = calculateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new Error("Paramètres de calcul invalides.");
  const v = parsed.data;
  if (!!v.source_document_type !== !!v.source_document_id) {
    throw new Error("Le type et l'identifiant de la pièce source doivent être renseignés ensemble.");
  }
  const { error } = await ctx.supabase.rpc("calculate_prospect_commission", {
    p_org: ctx.organizationId,
    p_prospect: v.prospect_id,
    p_policy: v.policy_id,
    p_source_document_type: v.source_document_type || null,
    p_source_document_id: v.source_document_id || null,
    p_request_key: randomUUID(),
  });
  if (error) throw new Error(error.message);
  revalidatePath("/commissions");
}

export async function reviewProspectCommission(formData: FormData) {
  const ctx = await requireOrganization();
  await assertPermission(ctx, "commissions.approve");
  const parsed = z.object({
    calculation_id: z.string().uuid(),
    decision: z.enum(["approve", "reject"]),
    reason: z.string().trim().max(1000).optional(),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new Error("Décision de validation invalide.");
  if (parsed.data.decision === "reject" && (parsed.data.reason || "").length < 3) {
    throw new Error("Un motif est obligatoire pour rejeter une prime.");
  }
  const { error } = await ctx.supabase.rpc("review_prospect_commission", {
    p_org: ctx.organizationId,
    p_calculation: parsed.data.calculation_id,
    p_decision: parsed.data.decision,
    p_reason: parsed.data.reason || null,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/commissions");
}

export async function recordCommissionPayment(formData: FormData) {
  const ctx = await requireOrganization();
  await assertPermission(ctx, "commissions.pay");
  const parsed = z.object({
    allocation_id: z.string().uuid(),
    amount: z.coerce.number().positive(),
    paid_at: z.string().date(),
    reference: z.string().trim().min(2).max(120),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new Error("Informations de paiement invalides.");
  const { error } = await ctx.supabase.rpc("record_commission_payment", {
    p_org: ctx.organizationId,
    p_allocation: parsed.data.allocation_id,
    p_amount: parsed.data.amount,
    p_paid_at: parsed.data.paid_at,
    p_reference: parsed.data.reference,
    p_request_key: randomUUID(),
  });
  if (error) throw new Error(error.message);
  revalidatePath("/commissions");
}
