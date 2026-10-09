"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrganization } from "@/lib/current-org";
import { assertPermission } from "@/lib/permissions";

const clientSchema = z.object({ name:z.string().min(2), email:z.string().email().optional().or(z.literal("")), phone:z.string().optional(), address:z.string().optional(), tax_id:z.string().optional() });
export async function createCustomer(formData: FormData) {
  const ctx = await requireOrganization();
  await assertPermission(ctx,"customers.create");
  const parsed=clientSchema.safeParse(Object.fromEntries(formData));
  if(!parsed.success) throw new Error("Vérifie les informations du client.");
  const {error}=await ctx.supabase.from("customers").insert({ organization_id:ctx.organizationId, ...parsed.data, email:parsed.data.email||null });
  if(error) throw new Error(error.message); revalidatePath("/clients");
}

const serviceSchema=z.object({ name:z.string().min(2), description:z.string().optional(), reference:z.string().optional(), unit:z.string().min(1), unit_price:z.coerce.number().nonnegative(), tax_rate:z.coerce.number().nonnegative().max(100) });
export async function createService(formData:FormData){ const ctx=await requireOrganization(); await assertPermission(ctx,"services.create"); const p=serviceSchema.safeParse(Object.fromEntries(formData)); if(!p.success)throw new Error("Vérifie les informations de la prestation."); const {error}=await ctx.supabase.from("services").insert({organization_id:ctx.organizationId,...p.data}); if(error)throw new Error(error.message); revalidatePath("/services"); }

export async function acceptQuote(quoteId:string){ const ctx=await requireOrganization(); await assertPermission(ctx,"quotes.accept"); const {error}=await ctx.supabase.rpc("accept_quote",{p_org:ctx.organizationId,p_quote:quoteId}); if(error)throw new Error(error.message); revalidatePath("/devis"); revalidatePath(`/devis/${quoteId}`); }
export async function convertQuoteToInvoice(quoteId:string){ const ctx=await requireOrganization(); await assertPermission(ctx,"invoices.create"); const {data,error}=await ctx.supabase.rpc("convert_quote_to_invoice",{p_org:ctx.organizationId,p_quote:quoteId}); if(error)throw new Error(error.message); revalidatePath("/factures"); revalidatePath(`/devis/${quoteId}`); return data as string; }
export async function issueInvoice(invoiceId:string){ const ctx=await requireOrganization(); await assertPermission(ctx,"invoices.issue"); const {error}=await ctx.supabase.rpc("issue_invoice",{p_org:ctx.organizationId,p_invoice:invoiceId}); if(error)throw new Error(error.message); revalidatePath("/factures"); revalidatePath(`/factures/${invoiceId}`); }

export async function recordPayment(formData:FormData){
  const ctx=await requireOrganization();
  await assertPermission(ctx,"payments.record");
  const p=z.object({invoice_id:z.string().uuid(),financial_account_id:z.string().uuid(),amount:z.coerce.number().positive(),paid_at:z.string().min(8),method:z.enum(["bank_transfer","cash","mobile_money","cheque","card","other"]),reference:z.string().optional()}).safeParse(Object.fromEntries(formData));
  if(!p.success)throw new Error("Paiement invalide.");
  const {error}=await ctx.supabase.rpc("record_invoice_payment",{p_org:ctx.organizationId,p_invoice:p.data.invoice_id,p_account:p.data.financial_account_id,p_amount:p.data.amount,p_paid_at:p.data.paid_at,p_method:p.data.method,p_reference:p.data.reference||null});
  if(error)throw new Error(error.message); revalidatePath("/factures"); revalidatePath("/paiements"); revalidatePath("/dashboard");
}

export async function createExpense(formData:FormData){
  const ctx=await requireOrganization();
  await assertPermission(ctx,"expenses.record");
  const p=z.object({description:z.string().min(2),amount:z.coerce.number().positive(),expense_date:z.string().min(8),financial_account_id:z.string().uuid(),category:z.string().min(1)}).safeParse(Object.fromEntries(formData));
  if(!p.success)throw new Error("Dépense invalide.");
  const {error}=await ctx.supabase.rpc("record_expense",{p_org:ctx.organizationId,p_description:p.data.description,p_amount:p.data.amount,p_date:p.data.expense_date,p_account:p.data.financial_account_id,p_category:p.data.category});
  if(error)throw new Error(error.message); revalidatePath("/depenses"); revalidatePath("/dashboard");
}


export async function addQuoteLine(formData:FormData){const ctx=await requireOrganization();await assertPermission(ctx,"quotes.edit");const p=z.object({quote_id:z.string().uuid(),service_id:z.string().uuid(),quantity:z.coerce.number().positive(),discount_pct:z.coerce.number().min(0).max(100)}).safeParse(Object.fromEntries(formData));if(!p.success)throw new Error("Ligne de devis invalide.");const {error}=await ctx.supabase.rpc("add_quote_line_from_service",{p_org:ctx.organizationId,p_quote:p.data.quote_id,p_service:p.data.service_id,p_quantity:p.data.quantity,p_discount_pct:p.data.discount_pct});if(error)throw new Error(error.message);revalidatePath(`/devis/${p.data.quote_id}`)}
export async function addInvoiceLine(formData:FormData){const ctx=await requireOrganization();await assertPermission(ctx,"invoices.create");const p=z.object({invoice_id:z.string().uuid(),service_id:z.string().uuid(),quantity:z.coerce.number().positive(),discount_pct:z.coerce.number().min(0).max(100)}).safeParse(Object.fromEntries(formData));if(!p.success)throw new Error("Ligne de facture invalide.");const {error}=await ctx.supabase.rpc("add_invoice_line_from_service",{p_org:ctx.organizationId,p_invoice:p.data.invoice_id,p_service:p.data.service_id,p_quantity:p.data.quantity,p_discount_pct:p.data.discount_pct});if(error)throw new Error(error.message);revalidatePath(`/factures/${p.data.invoice_id}`)}
export async function duplicateQuoteAction(quoteId:string){const ctx=await requireOrganization();await assertPermission(ctx,"quotes.create");const {data,error}=await ctx.supabase.rpc("duplicate_quote",{p_org:ctx.organizationId,p_quote:quoteId});if(error)throw new Error(error.message);return data as string}
export async function cancelInvoiceAction(formData:FormData){const ctx=await requireOrganization();await assertPermission(ctx,"invoices.cancel");const id=String(formData.get("invoice_id")||"");const reason=String(formData.get("reason")||"");const {error}=await ctx.supabase.rpc("cancel_invoice",{p_org:ctx.organizationId,p_invoice:id,p_reason:reason});if(error)throw new Error(error.message);revalidatePath(`/factures/${id}`);revalidatePath('/factures');revalidatePath('/dashboard')}
export async function transferFunds(formData:FormData){const ctx=await requireOrganization();await assertPermission(ctx,"treasury.transfer");const p=z.object({from:z.string().uuid(),to:z.string().uuid(),amount:z.coerce.number().positive(),date:z.string().min(8),reference:z.string().optional()}).safeParse(Object.fromEntries(formData));if(!p.success)throw new Error("Transfert invalide.");const {error}=await ctx.supabase.rpc("transfer_funds",{p_org:ctx.organizationId,p_from:p.data.from,p_to:p.data.to,p_amount:p.data.amount,p_date:p.data.date,p_reference:p.data.reference||null});if(error)throw new Error(error.message);revalidatePath('/tresorerie');revalidatePath('/dashboard')}
