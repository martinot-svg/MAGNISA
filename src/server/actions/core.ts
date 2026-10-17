"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
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

export async function reserveCashReceiptReference(requestKey: string, paidAt: string): Promise<string> {
  const ctx = await requireOrganization();
  await assertPermission(ctx, "payments.record");
  const parsed = z.object({
    requestKey: z.string().uuid(),
    paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }).safeParse({ requestKey, paidAt });
  if (!parsed.success) throw new Error("Date ou demande de reçu invalide.");
  const { data, error } = await ctx.supabase.rpc("reserve_cash_receipt_reference", {
    p_org: ctx.organizationId,
    p_request_key: parsed.data.requestKey,
    p_paid_at: parsed.data.paidAt,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function recordPayment(formData:FormData){
  const ctx=await requireOrganization();
  await assertPermission(ctx,"payments.record");
  const p=z.object({
    invoice_id:z.string().uuid(),financial_account_id:z.string().uuid(),
    amount:z.coerce.number().positive(),paid_at:z.string().min(8),
    method:z.enum(["bank_transfer","cash","mobile_money","cheque","card","other"]),
    reference:z.string().optional(),idempotency_key:z.string().uuid(),
    mobile_operator:z.string().optional(),
    mvola_fee_option:z.string().optional(),
    mvola_fee_amount:z.coerce.number().nonnegative().optional(),
  }).safeParse(Object.fromEntries(formData));
  if(!p.success)throw new Error("Paiement invalide.");
  const isMvola=p.data.method==="mobile_money"&&p.data.mobile_operator==="mvola";
  if(isMvola&&!["with_fees","without_fees"].includes(p.data.mvola_fee_option??"")){
    throw new Error("Indique si le client prend en charge les frais MVola.");
  }
  const feeAmount=p.data.mvola_fee_option==="with_fees"?p.data.mvola_fee_amount:0;
  if(isMvola && (feeAmount===undefined || !Number.isFinite(feeAmount) || (p.data.mvola_fee_option==="with_fees" && feeAmount<=0))){
    throw new Error("Indique le remboursement des frais réellement reçu sur MVola.");
  }
  if (isMvola) {
    const {data: wallet, error: walletError}=await ctx.supabase.from("financial_accounts")
      .select("id,name,type,is_active").eq("organization_id",ctx.organizationId)
      .eq("id",p.data.financial_account_id).maybeSingle();
    if(walletError)throw new Error(walletError.message);
    if(!wallet||!wallet.is_active||wallet.type!=="mobile_money"||wallet.name.trim().toLowerCase()!=="mvola"){
      throw new Error("Sélectionne un compte MVola actif correspondant à l'opérateur du paiement.");
    }
  }
  const paymentArgs={
    p_org:ctx.organizationId,p_invoice:p.data.invoice_id,
    p_account:p.data.financial_account_id,p_amount:p.data.amount,
    p_paid_at:p.data.paid_at,p_method:p.data.method,
    p_reference:p.data.reference||null,p_request_key:p.data.idempotency_key,
  };
  const {error}=isMvola
    ?await ctx.supabase.rpc("record_mvola_payment_with_reimbursement",{
      p_org:ctx.organizationId,p_invoice:p.data.invoice_id,
      p_account:p.data.financial_account_id,p_amount:p.data.amount,
      p_paid_at:p.data.paid_at,p_reference:p.data.reference||null,
      p_request_key:p.data.idempotency_key,p_fee_option:p.data.mvola_fee_option,
      p_fee_reimbursement:feeAmount,
    })
    :await ctx.supabase.rpc("lot1_record_invoice_payment_idempotent",paymentArgs);
  if(error)throw new Error(error.message);
  revalidatePath("/factures");revalidatePath("/paiements");revalidatePath("/dashboard");
  redirect("/paiements?enregistrement=succes");
}

export async function createExpense(formData:FormData){
  const ctx=await requireOrganization();
  await assertPermission(ctx,"expenses.record");
  const p=z.object({description:z.string().min(2),amount:z.coerce.number().positive(),expense_date:z.string().min(8),financial_account_id:z.string().uuid(),category:z.string().min(1),idempotency_key:z.string().uuid()}).safeParse(Object.fromEntries(formData));
  if(!p.success)throw new Error("Dépense invalide.");
  const {error}=await ctx.supabase.rpc("lot1_record_expense_idempotent",{p_org:ctx.organizationId,p_description:p.data.description,p_amount:p.data.amount,p_date:p.data.expense_date,p_account:p.data.financial_account_id,p_category:p.data.category,p_request_key:p.data.idempotency_key});
  if(error)throw new Error(error.message); revalidatePath("/depenses"); revalidatePath("/dashboard");
}


export async function addQuoteLine(formData:FormData){const ctx=await requireOrganization();await assertPermission(ctx,"quotes.edit");const p=z.object({quote_id:z.string().uuid(),service_id:z.string().uuid(),quantity:z.coerce.number().positive(),discount_pct:z.coerce.number().min(0).max(100)}).safeParse(Object.fromEntries(formData));if(!p.success)throw new Error("Ligne de devis invalide.");const {error}=await ctx.supabase.rpc("add_quote_line_from_service",{p_org:ctx.organizationId,p_quote:p.data.quote_id,p_service:p.data.service_id,p_quantity:p.data.quantity,p_discount_pct:p.data.discount_pct});if(error)throw new Error(error.message);revalidatePath(`/devis/${p.data.quote_id}`)}
export async function addInvoiceLine(formData:FormData){const ctx=await requireOrganization();await assertPermission(ctx,"invoices.create");const p=z.object({invoice_id:z.string().uuid(),service_id:z.string().uuid(),quantity:z.coerce.number().positive(),discount_pct:z.coerce.number().min(0).max(100)}).safeParse(Object.fromEntries(formData));if(!p.success)throw new Error("Ligne de facture invalide.");const {error}=await ctx.supabase.rpc("add_invoice_line_from_service",{p_org:ctx.organizationId,p_invoice:p.data.invoice_id,p_service:p.data.service_id,p_quantity:p.data.quantity,p_discount_pct:p.data.discount_pct});if(error)throw new Error(error.message);revalidatePath(`/factures/${p.data.invoice_id}`)}
export async function duplicateQuoteAction(quoteId:string){const ctx=await requireOrganization();await assertPermission(ctx,"quotes.create");const {data,error}=await ctx.supabase.rpc("duplicate_quote",{p_org:ctx.organizationId,p_quote:quoteId});if(error)throw new Error(error.message);return data as string}
export async function cancelInvoiceAction(formData:FormData){const ctx=await requireOrganization();await assertPermission(ctx,"invoices.cancel");const id=String(formData.get("invoice_id")||"");const reason=String(formData.get("reason")||"");const {error}=await ctx.supabase.rpc("cancel_invoice",{p_org:ctx.organizationId,p_invoice:id,p_reason:reason});if(error)throw new Error(error.message);revalidatePath(`/factures/${id}`);revalidatePath('/factures');revalidatePath('/dashboard')}
export async function transferFunds(formData:FormData){const ctx=await requireOrganization();await assertPermission(ctx,"treasury.transfer");const p=z.object({from:z.string().uuid(),to:z.string().uuid(),amount:z.coerce.number().positive(),date:z.string().min(8),reference:z.string().optional(),idempotency_key:z.string().uuid()}).safeParse(Object.fromEntries(formData));if(!p.success)throw new Error("Transfert invalide.");const {error}=await ctx.supabase.rpc("lot1_transfer_funds_idempotent",{p_org:ctx.organizationId,p_from:p.data.from,p_to:p.data.to,p_amount:p.data.amount,p_date:p.data.date,p_reference:p.data.reference||null,p_request_key:p.data.idempotency_key});if(error)throw new Error(error.message);revalidatePath('/tresorerie');revalidatePath('/dashboard')}

export async function recordInternalTransferDebit(fd:FormData){
 const ctx=await requireOrganization();await assertPermission(ctx,"treasury.transfer");
 const p=z.object({source:z.string().uuid(),destination:z.string().uuid(),date:z.string().date(),
  source_debit:z.coerce.number().positive(),destination_credit:z.coerce.number().positive(),
  operator_fee:z.coerce.number().nonnegative(),reference:z.string().trim().min(2),request_key:z.string().uuid()}).safeParse(Object.fromEntries(fd));
 if(!p.success)throw new Error("Données du transfert invalides.");
 const v=p.data;
 if(Math.abs(v.source_debit-v.destination_credit-v.operator_fee)>0.005)throw new Error("Débit source = crédit attendu + frais constatés.");
 const {error}=await ctx.supabase.rpc("magnisa_record_transfer_debit",{p_org:ctx.organizationId,p_source:v.source,p_destination:v.destination,p_date:v.date,p_source_debit:v.source_debit,p_destination_credit:v.destination_credit,p_fee:v.operator_fee,p_reference:v.reference,p_request_key:v.request_key});
 if(error)throw new Error(error.message);
 revalidatePath("/tresorerie");revalidatePath("/dashboard");revalidatePath("/tresorerie/comptes/"+v.source);
}
export async function confirmInternalTransferCredit(fd:FormData){
 const ctx=await requireOrganization();await assertPermission(ctx,"treasury.transfer");
 const p=z.object({transfer_id:z.string().uuid(),date:z.string().date(),reference:z.string().trim().min(2)}).safeParse(Object.fromEntries(fd));
 if(!p.success)throw new Error("Confirmation du crédit invalide.");
 const {error}=await ctx.supabase.rpc("magnisa_confirm_transfer_credit",{p_org:ctx.organizationId,p_transfer:p.data.transfer_id,p_date:p.data.date,p_reference:p.data.reference});
 if(error)throw new Error(error.message);
 revalidatePath("/tresorerie");revalidatePath("/dashboard");
}
