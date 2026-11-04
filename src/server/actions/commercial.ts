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
  if (!parsed.success || !z.string().date().safeParse(validUntil).success) throw new Error("VÃ©rifie le client, la validitÃ© et les prestations du devis.");
  const { data, error } = await ctx.supabase.rpc("create_quote_draft", { p_org: ctx.organizationId, p_customer: customerId, p_valid_until: validUntil, p_lines: parsed.data });
  if (error) throw new Error(error.message); revalidatePath("/devis"); redirect(`/devis/${data}`);
}

export async function createInvoiceDraft(formData: ¶»§q«^