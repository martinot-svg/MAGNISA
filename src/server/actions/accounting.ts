"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrganization } from "@/lib/current-org";
import { assertPermission } from "@/lib/permissions";

const uuid = z.string().uuid();

export async function createExpenseV2(formData: FormData) {
  const ctx = await requireOrganization();
  await assertPermission(ctx, "expenses.record");
  const p = z.object({
    description: z.string().trim().min(2), amount: z.coerce.number().positive(), expense_date: z.string().date(),
    financial_account_id: uuid, category: z.string().trim().min(3), expense_nature: z.enum(["expense", "fixed_asset", "advance", "tax", "social", "other"]),
    supplier_id: z.string().uuid().optional().or(z.literal("")), document_reference: z.string().trim().max(120).optional(), useful_life_months: z.coerce.number().int().positive().optional(),
    fee_amount: z.coerce.number().nonnegative(), fee_company_amount: z.coerce.number().nonnegative(), fee_client_amount: z.coerce.number().nonnegative(), fee_bearer: z.enum(["company", "client", "shared", "none"]), idempotency_key: uuid,
  }).safeParse(Object.fromEntries(formData));
  if (!p.success) throw new Error("Vérifie les informations de la dépense.");
  if (Math.round((p.data.fee_company_amount + p.data.fee_client_amount) * 100) !== Math.round(p.data.fee_amount * 100)) throw new Error("Les parts de frais doivent correspondre au total.");
  if (p.data.expense_nature === "fixed_asset" && !p.data.useful_life_months) throw new Error("Une durée d'utilisation est obligatoire pour une immobilisation.");
  const { error } = await ctx.supabase.rpc("lot1_record_expense_v2_idempotent", {
    p_org: ctx.organizationId, p_description: p.data.description, p_amount: p.data.amount, p_date: p.data.expense_date, p_account: p.data.financial_account_id,
    p_category: p.data.category, p_request_key: p.data.idempotency_key, p_expense_nature: p.data.expense_nature, p_supplier_id: p.data.supplier_id || null,
    p_document_reference: p.data.document_reference || null, p_useful_life_months: p.data.useful_life_months || null, p_fee_amount: p.data.fee_amount,
    p_fee_company_amount: p.data.fee_company_amount, p_fee_client_amount: p.data.fee_client_amount, p_fee_bearer: p.data.fee_bearer,
  });
  if (error) throw new Error(error.message);
  for (const path of ["/depenses", "/comptabilite", "/tresorerie", "/immobilisations", "/dashboard"]) revalidatePath(path);
}

export async function paySupplierV2(formData: FormData) {
  const ctx = await requireOrganization();
  await assertPermission(ctx, "suppliers.manage");
  const p = z.object({
    supplier_invoice_id: uuid, financial_account_id: uuid, amount: z.coerce.number().positive(), payment_date: z.string().date(), method: z.enum(["bank_transfer", "cash", "mobile_money", "cheque", "card", "other"]), reference: z.string().trim().optional(), idempotency_key: uuid,
    fee_amount: z.coerce.number().nonnegative(), fee_company_amount: z.coerce.number().nonnegative(), fee_client_amount: z.coerce.number().nonnegative(), fee_bearer: z.enum(["company", "client", "shared", "none"]),
  }).safeParse(Object.fromEntries(formData));
  if (!p.success) throw new Error("Vérifie les informations du règlement fournisseur.");
  if (Math.round((p.data.fee_company_amount + p.data.fee_client_amount) * 100) !== Math.round(p.data.fee_amount * 100)) throw new Error("Les parts de frais doivent correspondre au total.");
  const { error } = await ctx.supabase.rpc("lot2_record_supplier_payment_v2_idempotent", {
    p_org: ctx.organizationId, p_supplier_invoice: p.data.supplier_invoice_id, p_request_key: p.data.idempotency_key, p_account: p.data.financial_account_id,
    p_amount: p.data.amount, p_method: p.data.method, p_date: p.data.payment_date, p_reference: p.data.reference || null, p_fee_amount: p.data.fee_amount,
    p_fee_company_amount: p.data.fee_company_amount, p_fee_client_amount: p.data.fee_client_amount, p_fee_bearer: p.data.fee_bearer,
  });
  if (error) throw new Error(error.message);
  for (const path of ["/fournisseurs", "/dettes", "/tresorerie", "/comptabilite", "/dashboard"]) revalidatePath(path);
}
