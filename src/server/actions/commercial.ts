"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireOrganization } from "@/lib/current-org";
import { assertPermission } from "@/lib/permissions";

const lineSchema = z.object({ service_id: z.string().uuid(), quantity: z.coerce.number().finite().positive(), discount_pct: z.coerce.number().finite().min(0).max(100), unit_price: z.coerce.number().finite().nonnegative(), order_line_id: z.string().uuid().optional() });

export async function createQuoteDraft(formData: FormData) {
  const ctx = await requireOrganization(); await assertPermission(ctx, "quotes.create");
  const customerId = String(formData.get("customer_id") || ""); const validUntil = String(formData.get("valid_until") || "");
  let lines: unknown; try { lines = JSON.parse(String(formData.get("lines") || "[]")); } catch { throw new Error("Les lignes du devis sont invalides."); }
  const parsed = z.array(lineSchema).min(1).max(100).safeParse(lines);
  if (!parsed.success || !z.string().date().safeParse(validUntil).success) throw new Error("Vérifie le client, la validité et les prestations du devis.");
  const { data, error } = await ctx.supabase.rpc("create_quote_draft", { p_org: ctx.organizationId, p_customer: customerId, p_valid_until: validUntil, p_lines: parsed.data });
  if (error) throw new Error(error.message); revalidatePath("/devis"); redirect(`/devis/${data}`);
}

export async function createInvoiceDraft(formData: FormData) {
  const ctx = await requireOrganization(); await assertPermission(ctx, "invoices.create");
  const customerId = String(formData.get("customer_id") || ""); const dueDate = String(formData.get("due_date") || ""); const orderId = String(formData.get("order_id") || "").trim() || null;
  let lines: unknown; try { lines = JSON.parse(String(formData.get("lines") || "[]")); } catch { throw new Error("Les lignes de facture sont invalides."); }
  const parsedLines = z.array(lineSchema).min(1, "Ajoute au moins une prestation.").max(100).safeParse(lines); if (!parsedLines.success) throw new Error("Vérifie les prestations de la facture.");
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


export async function createRecurringServiceContractAction(formData: FormData) {
  const ctx = await requireOrganization();
  await assertPermission(ctx, "orders.manage");
  const parsed = z.object({
    order_id: z.string().uuid(),
    order_line_id: z.string().uuid(),
    start_date: z.string().date(),
    end_date: z.string().date().optional().or(z.literal("")),
    billing_day: z.coerce.number().int().min(1).max(28),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new Error("Vérifie les paramètres de la prestation récurrente.");
  if (parsed.data.end_date && parsed.data.end_date < parsed.data.start_date) {
    throw new Error("La date de fin doit être postérieure ou égale à la date de début.");
  }
  const { data: line, error: lineError } = await ctx.supabase
    .from("order_lines")
    .select("id,service_id,services(service_type,recurrence_frequency)")
    .eq("organization_id", ctx.organizationId)
    .eq("order_id", parsed.data.order_id)
    .eq("id", parsed.data.order_line_id)
    .maybeSingle();
  if (lineError || !line || !line.service_id) throw new Error("La ligne de commande est introuvable.");
  const service = Array.isArray(line.services) ? line.services[0] : line.services;
  if (service?.service_type !== "recurring" || !service?.recurrence_frequency) {
    throw new Error("Cette ligne n'est pas définie comme une prestation récurrente dans le catalogue Services.");
  }
  const { error } = await ctx.supabase.rpc("create_recurring_service_contract", {
    p_org: ctx.organizationId,
    p_order: parsed.data.order_id,
    p_order_line: parsed.data.order_line_id,
    p_frequency: service.recurrence_frequency,
    p_start_date: parsed.data.start_date,
    p_end_date: parsed.data.end_date || null,
    p_billing_day: parsed.data.billing_day,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/commandes");
  revalidatePath("/prestations-recurrentes");
  redirect("/prestations-recurrentes?created=1");
}

export async function setRecurringServiceStatusAction(formData: FormData) {
  const ctx = await requireOrganization();
  await assertPermission(ctx, "orders.manage");
  const parsed = z.object({
    contract_id: z.string().uuid(),
    status: z.enum(["active", "suspended", "cancelled"]),
    reason: z.string().trim().max(500).optional(),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new Error("Demande de modification de la prestation récurrente invalide.");
  if (parsed.data.status !== "active" && (parsed.data.reason || "").trim().length < 3) {
    throw new Error("Un motif d'au moins 3 caractères est obligatoire.");
  }
  const { error } = await ctx.supabase.rpc("set_recurring_service_status", {
    p_org: ctx.organizationId,
    p_contract: parsed.data.contract_id,
    p_status: parsed.data.status,
    p_reason: parsed.data.reason || null,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/prestations-recurrentes");
  revalidatePath("/factures");
}
