"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrganization } from "@/lib/current-org";
import { assertPermission } from "@/lib/permissions";

const creditNoteLinesSchema = z.array(z.object({
  invoice_line_id: z.string().uuid(),
  quantity: z.coerce.number().finite().positive(),
  stock_return_line_id: z.string().uuid().optional(),
})).min(1).max(100);

export async function issueCustomerCreditNoteAction(formData: FormData) {
  const ctx = await requireOrganization();
  await assertPermission(ctx, "invoices.issue");
  const rawLines = z.string().min(2).parse(formData.get("lines"));
  let parsedLines: unknown;
  try {
    parsedLines = JSON.parse(rawLines);
  } catch {
    throw new Error("Les lignes de l'avoir ne sont pas un JSON valide.");
  }
  const parsed = z.object({
    invoice_id: z.string().uuid(),
    issue_date: z.string().date(),
    reason: z.string().trim().min(3).max(500),
    request_key: z.string().uuid(),
    lines: creditNoteLinesSchema,
  }).parse({
    invoice_id: formData.get("invoice_id"),
    issue_date: formData.get("issue_date"),
    reason: formData.get("reason"),
    request_key: formData.get("request_key"),
    lines: parsedLines,
  });
  const { data, error } = await ctx.supabase.rpc("issue_customer_credit_note", {
    p_org: ctx.organizationId,
    p_invoice_id: parsed.invoice_id,
    p_issue_date: parsed.issue_date,
    p_lines: parsed.lines,
    p_reason: parsed.reason,
    p_request_key: parsed.request_key,
  });
  if (error) throw new Error("Émission de l'avoir impossible : " + error.message);
  revalidatePath("/factures");
  revalidatePath(`/factures/${parsed.invoice_id}`);
  revalidatePath("/comptabilite/journaux");
  return data;
}

export async function recordCustomerCreditNoteRefundAction(formData: FormData) {
  const ctx = await requireOrganization();
  await assertPermission(ctx, "payments.record");
  const parsed = z.object({
    credit_note_id: z.string().uuid(),
    financial_account_id: z.string().uuid(),
    amount: z.coerce.number().finite().positive(),
    refund_date: z.string().date(),
    method: z.enum(["bank_transfer", "cash", "mobile_money", "cheque", "card", "other"]),
    reference: z.string().trim().min(1).max(120),
    request_key: z.string().uuid(),
  }).parse({
    credit_note_id: formData.get("credit_note_id"),
    financial_account_id: formData.get("financial_account_id"),
    amount: formData.get("amount"),
    refund_date: formData.get("refund_date"),
    method: formData.get("method"),
    reference: formData.get("reference"),
    request_key: formData.get("request_key"),
  });
  const { data, error } = await ctx.supabase.rpc("record_customer_credit_note_refund", {
    p_org: ctx.organizationId,
    p_credit_note_id: parsed.credit_note_id,
    p_financial_account_id: parsed.financial_account_id,
    p_amount: parsed.amount,
    p_refund_date: parsed.refund_date,
    p_method: parsed.method,
    p_reference: parsed.reference,
    p_request_key: parsed.request_key,
  });
  if (error) throw new Error("Remboursement de l'avoir impossible : " + error.message);
  revalidatePath("/factures");
  revalidatePath("/comptabilite/journaux");
  return data;
}
