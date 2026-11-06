"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrganization } from "@/lib/current-org";
import { assertPermission } from "@/lib/permissions";

const contributionTypes = ["originator", "qualifier", "negotiator", "closer"] as const;
const policyBasis = ["order_total", "invoice_paid_amount", "fixed_amount"] as const;

function requiredUuid(value: FormDataEntryValue | null, label: string) {
  const parsed = z.string().uuid().safeParse(String(value ?? ""));
  if (!parsed.success) throw new Error(label + " invalide.");
  return parsed.data;
}

export async function createProspect(formData: FormData) {
  const ctx = await requireOrganization();
  await assertPermission(ctx, "commissions.contribute");
  const parsed = z.object({
    name: z.string().trim().min(2).max(180),
    email: z.string().trim().email().max(254).or(z.literal("")),
    phone: z.string().trim().max(40),
    source: z.string().trim().max(120),
    notes: z.string().trim().max(2000),
  }).safeParse({
    name: formData.get("name"),
    email: String(formData.get("email") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    source: String(formData.get("source") ?? ""),
    notes: String(formData.get("notes") ?? ""),
  });
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

export async function convertProspectToCustomer(formData: FormData) {
  const ctx = await requireOrganization();
  await assertPermission(ctx, "prospects.convert");
  const prospectId = requiredUuid(formData.get("prospect_id"), "Prospect");
  const { error } = await ctx.supabase.rpc("convert_prospect_to_customer", {
    p_org: ctx.organizationId,
    p_prospect: prospectId,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/prospects");
  revalidatePath("/clients");
  revalidatePath("/commissions");
}

export async function addProspectContributor(formData: FormData) {
  const ctx = await requireOrganization();
  await assertPermission(ctx, "commissions.contribute");
  const parsed = z.object({
    prospect_id: z.string().uuid(),
    contribution_type: z.enum(contributionTypes),
    notes: z.string().trim().max(1000),
  }).safeParse({
    prospect_id: String(formData.get("prospect_id") ?? ""),
    contribution_type: String(formData.get("contribution_type") ?? ""),
    notes: String(formData.get("notes") ?? ""),
  });
  if (!parsed.success) throw new Error("Contribution invalide.");
  const { error } = await ctx.supabase.from("prospect_contributors").insert({
    organization_id: ctx.organizationId,
    prospect_id: parsed.data.prospect_id,
    user_id: ctx.user.id,
    contribution_type: parsed.data.contribution_type,
    notes: parsed.data.notes || null,
    created_by: ctx.user.id,
  });
  if (error) throw new Error(error.code === "23505" ? "Cette contribution est déjà enregistrée." : error.message);
  revalidatePath("/commissions");
  revalidatePath("/prospects");
}

export async function saveCommissionPolicy(formData: FormData) {
  const ctx = await requireOrganization();
  await assertPermission(ctx, "commissions.policy.manage");
  const { data: organization, error: organizationError } = await ctx.supabase
    .from("organizations")
    .select("currency")
    .eq("id", ctx.organizationId)
    .single();
  if (organizationError || !organization?.currency) {
    throw new Error("Impossible de déterminer la devise de l'entreprise.");
  }
  const parsed = z.object({
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(1000),
    calculation_basis: z.enum(policyBasis),
    tax_basis: z.enum(["net", "gross"]),
    commission_rate: z.coerce.number().finite().positive().max(100),
    fixed_basis_amount: z.string(),
    expense_account_code: z.string().trim().min(3).max(10),
    effective_from: z.iso.date(),
    effective_until: z.string().optional(),
    is_active: z.boolean(),
    originator: z.coerce.number().min(0).max(100),
    qualifier: z.coerce.number().min(0).max(100),
    negotiator: z.coerce.number().min(0).max(100),
    closer: z.coerce.number().min(0).max(100),
  }).safeParse({
    name: String(formData.get("name") ?? ""),
    description: String(formData.get("description") ?? ""),
    calculation_basis: String(formData.get("calculation_basis") ?? ""),
    tax_basis: String(formData.get("tax_basis") ?? "net"),
    commission_rate: String(formData.get("commission_rate") ?? ""),
    fixed_basis_amount: String(formData.get("fixed_basis_amount") ?? ""),
    expense_account_code: String(formData.get("expense_account_code") ?? ""),
    effective_from: String(formData.get("effective_from") ?? ""),
    effective_until: String(formData.get("effective_until") ?? ""),
    is_active: formData.get("is_active") === "on",
    originator: String(formData.get("originator") ?? "0"),
    qualifier: String(formData.get("qualifier") ?? "0"),
    negotiator: String(formData.get("negotiator") ?? "0"),
    closer: String(formData.get("closer") ?? "0"),
  });
  if (!parsed.success) throw new Error("Vérifie les paramètres de la politique de prime.");
  const fixedBasisAmount = parsed.data.fixed_basis_amount.trim()
    ? Number(parsed.data.fixed_basis_amount)
    : null;
  if (parsed.data.calculation_basis === "fixed_amount" &&
      (!Number.isFinite(fixedBasisAmount) || fixedBasisAmount === null || fixedBasisAmount <= 0)) {
    throw new Error("Le montant de base fixe doit être strictement positif.");
  }
  const rules = [
    { contribution_type: "originator", share_percentage: parsed.data.originator },
    { contribution_type: "qualifier", share_percentage: parsed.data.qualifier },
    { contribution_type: "negotiator", share_percentage: parsed.data.negotiator },
    { contribution_type: "closer", share_percentage: parsed.data.closer },
  ].filter((rule) => rule.share_percentage > 0);
  if (rules.length === 0 || Math.abs(rules.reduce((sum, rule) => sum + rule.share_percentage, 0) - 100) > 0.00001) {
    throw new Error("La répartition des rôles doit totaliser exactement 100 %.");
  }
  const { error } = await ctx.supabase.rpc("save_commission_policy", {
    p_org: ctx.organizationId,
    p_policy: null,
    p_name: parsed.data.name,
    p_description: parsed.data.description || null,
    p_active: parsed.data.is_active,
    p_effective_from: parsed.data.effective_from,
    p_effective_until: parsed.data.effective_until || null,
    p_basis: parsed.data.calculation_basis,
    p_tax_basis: parsed.data.tax_basis,
    p_rate: parsed.data.commission_rate,
    p_fixed_basis_amount: parsed.data.calculation_basis === "fixed_amount" ? fixedBasisAmount : null,
    p_currency: organization.currency,
    p_expense_account_code: parsed.data.expense_account_code,
    p_rules: rules,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/commissions");
}

export async function calculateProspectCommission(formData: FormData) {
  const ctx = await requireOrganization();
  await assertPermission(ctx, "commissions.calculate");
  const parsed = z.object({
    prospect_id: z.string().uuid(),
    policy_id: z.string().uuid(),
    request_key: z.string().uuid(),
    source_document: z.string().optional(),
  }).safeParse({
    prospect_id: String(formData.get("prospect_id") ?? ""),
    policy_id: String(formData.get("policy_id") ?? ""),
    request_key: String(formData.get("request_key") ?? ""),
    source_document: String(formData.get("source_document") ?? "") || undefined,
  });
  if (!parsed.success) throw new Error("Sélectionne le prospect, la politique et la pièce source correspondante.");
  let sourceDocumentType: "order" | "invoice" | null = null;
  let sourceDocumentId: string | null = null;
  if (parsed.data.source_document) {
    const [type, id, extra] = parsed.data.source_document.split(":");
    const typeResult = z.enum(["order", "invoice"]).safeParse(type);
    const idResult = z.string().uuid().safeParse(id);
    if (!typeResult.success || !idResult.success || extra !== undefined) {
      throw new Error("La pièce source sélectionnée est invalide.");
    }
    sourceDocumentType = typeResult.data;
    sourceDocumentId = idResult.data;
  }
  const { data: policy, error: policyError } = await ctx.supabase
    .from("commission_policies").select("calculation_basis")
    .eq("id", parsed.data.policy_id).eq("organization_id", ctx.organizationId).single();
  if (policyError || !policy) throw new Error("Politique de commission introuvable.");
  const expectedSourceType = policy.calculation_basis === "order_total"
    ? "order"
    : policy.calculation_basis === "invoice_paid_amount" ? "invoice" : null;
  if (expectedSourceType !== sourceDocumentType) {
    throw new Error(expectedSourceType
      ? "La politique exige une pièce source du type correspondant."
      : "Une politique à montant fixe ne doit pas recevoir de pièce source.");
  }
  const { error } = await ctx.supabase.rpc("calculate_prospect_commission", {
    p_org: ctx.organizationId,
    p_prospect: parsed.data.prospect_id,
    p_policy: parsed.data.policy_id,
    p_source_document_type: sourceDocumentType,
    p_source_document_id: sourceDocumentId,
    p_request_key: parsed.data.request_key,
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
    reason: z.string().trim().max(1000),
  }).safeParse({
    calculation_id: String(formData.get("calculation_id") ?? ""),
    decision: String(formData.get("decision") ?? ""),
    reason: String(formData.get("reason") ?? ""),
  });
  if (!parsed.success) throw new Error("Décision de validation invalide.");
  if (parsed.data.decision === "reject" && parsed.data.reason.length < 3) {
    throw new Error("Un motif de rejet d'au moins 3 caractères est obligatoire.");
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
  await assertPermission(ctx, "expenses.record");
  const parsed = z.object({
    allocation_id: z.string().uuid(),
    financial_account_id: z.string().uuid(),
    request_key: z.string().uuid(),
    amount: z.coerce.number().finite().positive(),
    paid_at: z.iso.date(),
    reference: z.string().trim().min(2).max(160),
  }).safeParse({
    allocation_id: String(formData.get("allocation_id") ?? ""),
    financial_account_id: String(formData.get("financial_account_id") ?? ""),
    request_key: String(formData.get("request_key") ?? ""),
    amount: String(formData.get("amount") ?? ""),
    paid_at: String(formData.get("paid_at") ?? ""),
    reference: String(formData.get("reference") ?? ""),
  });
  if (!parsed.success) throw new Error("Données de paiement invalides.");
  const { error } = await ctx.supabase.rpc("record_commission_payment", {
    p_org: ctx.organizationId,
    p_allocation: parsed.data.allocation_id,
    p_account: parsed.data.financial_account_id,
    p_amount: parsed.data.amount,
    p_paid_at: parsed.data.paid_at,
    p_reference: parsed.data.reference,
    p_request_key: parsed.data.request_key,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/commissions");
}
