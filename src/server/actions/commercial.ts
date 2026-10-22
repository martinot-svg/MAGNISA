"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireOrganization } from "@/lib/current-org";
import { assertPermission } from "@/lib/permissions";

const lineSchema = z.object({ service_id: z.string().uuid(), quantity: z.coerce.number().positive(), discount_pct: z.coerce.number().min(0).max(100) });

export async function createInvoiceDraft(formData: FormData) {
  const ctx = await requireOrganization(); await assertPermission(ctx, "invoices.create");
  const customerId = String(formData.get("customer_id") || ""); const dueDate = String(formData.get("due_date") || ""); const orderId = String(formData.get("order_id") || "").trim() || null;
  let lines: unknown; try { lines = JSON.parse(String(formData.get("lines") || "[]")); } catch { throw new Error("Les lignes de facture sont invalides."); }
  const parsedLines = z.array(lineSchema).min(1, "Ajoute au moins une prestation.").safeParse(lines); if (!parsedLines.success) throw new Error("Vérifie les prestations de la facture.");
  if (!z.string().date().safeParse(dueDate).success) throw new Error("Date d'échéance invalide.");
  const { data, error } = await ctx.supabase.rpc("create_invoice_draft", { p_org: ctx.organizationId, p_customer: customerId, p_due_date: dueDate, p_lines: parsedLines.data, p_order: orderId });
  if (error) throw new Error(error.message); revalidatePath("/factures"); if (orderId) revalidatePath("/commandes"); redirect(`/factures/${data}`);
}

export async function cancelQuoteAction(formData: FormData) {
  const ctx = await requireOrganization(); await assertPermission(ctx, "quotes.edit"); const id = String(formData.get("quote_id") || ""); const reason = String(formData.get("reason") || "");
  const { error } = await ctx.supabase.rpc("cancel_quote", { p_org: ctx.organizationId, p_quote: id, p_reason: reason }); if (error) throw new Error(error.message); revalidatePath(`/devis/${id}`); revalidatePath("/devis");
}

export async function cancelOrderAction(formData: FormData) {
  const ctx = await requireOrganization(); await assertPermission(ctx, "orders.manage"); const id = String(formData.get("order_id") || ""); const reason = String(formData.get("reason") || "");
  const { error } = await ctx.supabase.rpc("cancel_order", { p_org: ctx.organizationId, p_order: id, p_reason: reason }); if (error) throw new Error(error.message); revalidatePath("/commandes"); revalidatePath("/factures");
}

export async function updateInvoiceLineAction(formData: FormData) {
  const ctx = await requireOrganization(); await assertPermission(ctx, "invoices.create"); const p = z.object({ line_id: z.string().uuid(), quantity: z.coerce.number().positive(), discount_pct: z.coerce.number().min(0).max(100), invoice_id: z.string().uuid() }).safeParse(Object.fromEntries(formData));
  if (!p.success) throw new Error("Ligne de facture invalide."); const { error } = await ctx.supabase.rpc("update_invoice_line", { p_org: ctx.organizationId, p_line: p.data.line_id, p_quantity: p.data.quantity, p_discount_pct: p.data.discount_pct }); if (error) throw new Error(error.message); revalidatePath(`/factures/${p.data.invoice_id}`);
}

export async function deleteInvoiceLineAction(formData: FormData) {
  const ctx = await requireOrganization(); await assertPermission(ctx, "invoices.create"); const p = z.object({ line_id: z.string().uuid(), invoice_id: z.string().uuid() }).safeParse(Object.fromEntries(formData));
  if (!p.success) throw new Error("Ligne de facture invalide."); const { error } = await ctx.supabase.rpc("delete_invoice_line", { p_org: ctx.organizationId, p_line: p.data.line_id }); if (error) throw new Error(error.message); revalidatePath(`/factures/${p.data.invoice_id}`);
}
