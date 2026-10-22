"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireOrganization } from "@/lib/current-org";
import { assertPermission } from "@/lib/permissions";

export async function recordPaymentAutomated(formData: FormData) {
  const ctx = await requireOrganization();
  await assertPermission(ctx, "payments.record");
  const p = z.object({
    invoice_id: z.string().uuid(),
    financial_account_id: z.string().uuid(),
    amount: z.coerce.number().positive(),
    paid_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    method: z.enum(["bank_transfer", "cash", "mobile_money", "cheque", "card", "other"]),
    reference: z.string().trim().optional(),
    idempotency_key: z.string().uuid(),
    mobile_operator: z.string().optional(),
    mvola_fee_bearer: z.enum(["none", "company", "client_direct", "client_reimbursed"]).optional(),
    mvola_fee_amount: z.coerce.number().nonnegative().optional(),
  }).safeParse(Object.fromEntries(formData));
  if (!p.success) throw new Error("Paiement invalide.");

  const isMvola = p.data.method === "mobile_money" && p.data.mobile_operator === "mvola";
  const bearer = isMvola ? (p.data.mvola_fee_bearer ?? "none") : "none";
  const feeAmount = isMvola ? (p.data.mvola_fee_amount ?? 0) : 0;

  if (isMvola) {
    if (bearer !== "none" && feeAmount <= 0) throw new Error("Indique le montant réel des frais Mobile Money.");
    if (bearer === "none" && feeAmount !== 0) throw new Error("Sans frais, le montant des frais doit être zéro.");
    const { data: wallet, error: walletError } = await ctx.supabase.from("financial_accounts")
      .select("id,name,type,is_active")
      .eq("organization_id", ctx.organizationId)
      .eq("id", p.data.financial_account_id)
      .maybeSingle();
    if (walletError) throw new Error(walletError.message);
    if (!wallet || !wallet.is_active || wallet.type !== "mobile_money" || wallet.name.trim().toLowerCase() !== "mvola") {
      throw new Error("Sélectionne un compte MVola actif correspondant à l'opérateur du paiement.");
    }
  }

  const { error } = await ctx.supabase.rpc("record_customer_payment_with_fee", {
    p_org: ctx.organizationId,
    p_invoice: p.data.invoice_id,
    p_account: p.data.financial_account_id,
    p_amount: p.data.amount,
    p_paid_at: p.data.paid_at,
    p_method: p.data.method,
    p_reference: p.data.reference || null,
    p_request_key: p.data.idempotency_key,
    p_fee_amount: feeAmount,
    p_fee_bearer: bearer,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/factures");
  revalidatePath("/paiements");
  revalidatePath("/dashboard");
  revalidatePath("/comptabilite");
  redirect("/paiements?enregistrement=succes");
}
