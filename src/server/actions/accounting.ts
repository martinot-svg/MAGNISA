"use server";

import { revalidatePath } from "next/cache";
import { requireOrganization } from "@/lib/current-org";
import { assertPermission } from "@/lib/permissions";
import { assertExpenseNature, assertFeeBearer, customerPaymentInputSchema, expenseInputSchema, supplierPaymentInputSchema } from "@/server/accounting-validation";

export async function createExpenseV2(formData: FormData) {
  const ctx = await requireOrganization();
  await assertPermission(ctx, "expenses.record");
  const p = expenseInputSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) throw new Error("Vérifie les informations de la dépense.");
  assertFeeBearer(p.data.fee_bearer, p.data.fee_amount, p.data.fee_company_amount, p.data.fee_client_amount);
  assertExpenseNature(p.data.expense_nature, p.data.useful_life_months);
  const { error } = await ctx.supabase.rpc("lot1_record_expense_v2_idempotent", {
    p_org: ctx.organizationId, p_description: p.data.description, p_amount: p.data.amount, p_date: p.data.expense_date,
    p_account: p.data.financial_account_id, p_category: p.data.category, p_request_key: p.data.idempotency_key,
    p_expense_nature: p.data.expense_nature, p_supplier_id: p.data.supplier_id || null, p_document_reference: p.data.document_reference || null,
    p_useful_life_months: p.data.useful_life_months || null, p_fee_amount: p.data.fee_amount, p_fee_company_amount: p.data.fee_company_amount,
    p_fee_client_amount: p.data.fee_client_amount, p_fee_bearer: p.data.fee_bearer,
  });
  if (error) throw new Error(error.message);
  for (const path of ["/depenses", "/comptabilite", "/tresorerie", "/immobilisations", "/dashboard"]) revalidatePath(path);
}

export async function paySupplierV2(formData: FormData) {
  const ctx = await requireOrganization();
  await assertPermission(ctx, "suppliers.manage");
  const p = supplierPaymentInputSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) throw new Error("Vérifie les informations du règlement fournisseur.");
  assertFeeBearer(p.data.fee_bearer, p.data.fee_amount, p.data.fee_company_amount, p.data.fee_client_amount);
  const { error } = await ctx.supabase.rpc("lot2_record_supplier_payment_v2_idempotent", {
    p_org: ctx.organizationId, p_supplier_invoice: p.data.supplier_invoice_id, p_request_key: p.data.idempotency_key,
    p_account: p.data.financial_account_id, p_amount: p.data.amount, p_method: p.data.method, p_date: p.data.payment_date,
    p_reference: p.data.reference || null, p_fee_amount: p.data.fee_amount, p_fee_company_amount: p.data.fee_company_amount,
    p_fee_client_amount: p.data.fee_client_amount, p_fee_bearer: p.data.fee_bearer,
  });
  if (error) throw new Error(error.message);
  for (const path of ["/fournisseurs", "/dettes", "/tresorerie", "/comptabilite", "/dashboard"]) revalidatePath(path);
}

export async function recordCustomerPaymentV2(formData: FormData) {
  const ctx = await requireOrganization();
  await assertPermission(ctx, "payments.record");
  const p = customerPaymentInputSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) throw new Error("Paiement invalide.");
  const isMobileMoney = p.data.method === "mobile_money";
  if (isMobileMoney && !p.data.mobile_operator) throw new Error("Sélectionne l’opérateur Mobile Money utilisé.");
  if (!isMobileMoney && (p.data.mobile_operator || p.data.mobile_operator_name)) throw new Error("L’opérateur Mobile Money ne peut être renseigné que pour un paiement Mobile Money.");
  const isMvola = isMobileMoney && p.data.mobile_operator === "mvola";
  if (isMvola && !p.data.mvola_fee_option) throw new Error("Indique si le client prend en charge les frais MVola.");
  const feeOption = p.data.mvola_fee_option;
  const fee = feeOption === "with_fees" || feeOption === "company_pays" ? Number(p.data.mvola_fee_amount || 0) : 0;
  if (isMvola && (feeOption === "with_fees" || feeOption === "company_pays") && (!Number.isInteger(fee) || fee <= 0)) {
    throw new Error("Indique le montant entier des frais réellement constatés sur le justificatif MVola.");
  }
  if (!isMvola && feeOption) throw new Error("L’option de frais MVola n’est valable que pour un paiement MVola.");
  if (isMobileMoney) {
    const { data: wallet, error: walletError } = await ctx.supabase.from("financial_accounts").select("id,name,type,is_active,details,mvola_account_category").eq("organization_id", ctx.organizationId).eq("id", p.data.financial_account_id).maybeSingle();
    if (walletError) throw new Error(walletError.message);
    const walletName = wallet?.name.trim().toLowerCase() ?? "";
    const matchesOperator = p.data.mobile_operator === "mvola" ? walletName.includes("mvola")
      : p.data.mobile_operator === "orange_money" ? walletName.includes("orange")
      : p.data.mobile_operator === "airtel_money" ? walletName.includes("airtel") : false;
    if (!wallet || !wallet.is_active || wallet.type !== "mobile_money" || !matchesOperator) throw new Error("Le compte financier sélectionné ne correspond pas à l’opérateur Mobile Money.");
    if (isMvola) {
      const category = wallet.mvola_account_category || (wallet.details && typeof wallet.details === "object" ? (wallet.details as Record<string, unknown>).account_type : null);
      if (!["personal", "business", "merchant"].includes(String(category ?? ""))) throw new Error("La catégorie du compte MVola doit être renseignée avant d'enregistrer le paiement.");
      if (wallet.mvola_account_category && wallet.details && typeof wallet.details === "object" && (wallet.details as Record<string, unknown>).account_type && wallet.mvola_account_category !== (wallet.details as Record<string, unknown>).account_type) {
        throw new Error("La catégorie MVola du compte est incohérente. Corrige-la dans la trésorerie avant d'enregistrer le paiement.");
      }
    }
  }
  const { error } = await ctx.supabase.rpc("record_customer_payment_with_fee_v2", {
    p_org: ctx.organizationId, p_invoice: p.data.invoice_id, p_account: p.data.financial_account_id, p_amount: p.data.amount,
    p_paid_at: p.data.paid_at, p_method: p.data.method, p_reference: p.data.reference || null, p_request_key: p.data.idempotency_key,
    p_fee_amount: fee, p_fee_bearer: feeOption === "company_pays" ? "company" : feeOption === "with_fees" ? "client_reimbursed" : "none",
  });
  if (error) throw new Error(error.message);
  for (const path of ["/factures", "/paiements", "/tresorerie", "/comptabilite", "/dashboard"]) revalidatePath(path);
}
