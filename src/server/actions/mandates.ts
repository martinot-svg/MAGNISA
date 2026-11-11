"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrganization } from "@/lib/current-org";
import { assertPermission } from "@/lib/permissions";

export async function recordCustomerMandateDisbursement(formData: FormData) {
  const ctx=await requireOrganization();
  await assertPermission(ctx,"suppliers.manage");
  const p=z.object({
    purchase_order_line_id:z.string().uuid(),
    supplier_document_reference:z.string().trim().min(1).max(160),
    document_date:z.string().date(),
    amount:z.coerce.number().finite().positive(),
    financial_account_id:z.string().uuid(),
    disbursed_at:z.string().date(),
    request_key:z.string().uuid(),
  }).safeParse(Object.fromEntries(formData));
  if(!p.success) throw new Error("Vérifie la pièce fournisseur et le règlement du mandat.");
  const {error}=await ctx.supabase.rpc("record_customer_mandate_disbursement",{
    p_org:ctx.organizationId,p_purchase_order_line:p.data.purchase_order_line_id,
    p_supplier_document_reference:p.data.supplier_document_reference,p_document_date:p.data.document_date,
    p_amount:p.data.amount,p_account:p.data.financial_account_id,p_disbursed_at:p.data.disbursed_at,
    p_request_key:p.data.request_key,
  });
  if(error) throw new Error(error.message);
  for(const path of ["/mandats-clients","/approvisionnements","/tresorerie","/comptabilite","/dashboard"]) revalidatePath(path);
}

export async function recordCustomerMandateReimbursement(formData: FormData) {
  const ctx=await requireOrganization();
  await assertPermission(ctx,"payments.record");
  const p=z.object({
    disbursement_id:z.string().uuid(),
    financial_account_id:z.string().uuid(),
    amount:z.coerce.number().finite().positive(),
    reimbursement_date:z.string().date(),
    reference:z.string().trim().max(160).optional(),
    request_key:z.string().uuid(),
  }).safeParse(Object.fromEntries(formData));
  if(!p.success) throw new Error("Vérifie le remboursement du débours client.");
  const {error}=await ctx.supabase.rpc("record_customer_mandate_reimbursement",{
    p_org:ctx.organizationId,p_disbursement:p.data.disbursement_id,p_account:p.data.financial_account_id,
    p_amount:p.data.amount,p_date:p.data.reimbursement_date,p_reference:p.data.reference||null,
    p_request_key:p.data.request_key,
  });
  if(error) throw new Error(error.message);
  for(const path of ["/mandats-clients","/tresorerie","/comptabilite","/dashboard"]) revalidatePath(path);
}
