import { z } from "zod";

export const expenseInputSchema = z.object({
  description: z.string().trim().min(2), amount: z.coerce.number().positive(), expense_date: z.string().date(),
  financial_account_id: z.string().uuid(), category: z.string().trim().min(3),
  expense_nature: z.enum(["expense", "fixed_asset", "advance", "tax", "social", "other"]),
  supplier_id: z.string().uuid().optional().or(z.literal("")), document_reference: z.string().trim().max(120).optional(),
  useful_life_months: z.coerce.number().int().positive().optional(), fee_amount: z.coerce.number().nonnegative(),
  fee_company_amount: z.coerce.number().nonnegative(), fee_client_amount: z.coerce.number().nonnegative(),
  fee_bearer: z.enum(["company", "client", "shared", "none"]), idempotency_key: z.string().uuid(),
});

export const supplierPaymentInputSchema = z.object({
  supplier_invoice_id: z.string().uuid(), financial_account_id: z.string().uuid(), amount: z.coerce.number().positive(),
  payment_date: z.string().date(), method: z.enum(["bank_transfer", "cash", "mobile_money", "cheque", "card", "other"]),
  reference: z.string().trim().optional(), idempotency_key: z.string().uuid(), fee_amount: z.coerce.number().nonnegative(),
  fee_company_amount: z.coerce.number().nonnegative(), fee_client_amount: z.coerce.number().nonnegative(),
  fee_bearer: z.enum(["company", "client", "shared", "none"]),
});

export const customerPaymentInputSchema = z.object({
  invoice_id: z.string().uuid(), financial_account_id: z.string().uuid(), amount: z.coerce.number().positive(),
  paid_at: z.string().date(), method: z.enum(["bank_transfer", "cash", "mobile_money", "cheque", "card", "other"]),
  reference: z.string().trim().optional(), idempotency_key: z.string().uuid(), mobile_operator: z.string().trim().optional(),
  mvola_fee_option: z.enum(["with_fees", "without_fees"]).optional(), mvola_fee_amount: z.coerce.number().nonnegative().optional(),
});

export function assertFeeSplit(total: number, company: number, client: number) {
  if (Math.round((company + client) * 100) !== Math.round(total * 100)) throw new Error("Les parts de frais doivent correspondre au total.");
  if (total === 0 && (company !== 0 || client !== 0)) throw new Error("Un frais nul ne peut avoir de répartition.");
}

export function assertFeeBearer(bearer: "company" | "client" | "shared" | "none", total: number, company: number, client: number) {
  assertFeeSplit(total, company, client);
  if (bearer === "none" && total !== 0) throw new Error("Un frais déclaré inexistant doit être nul");
  if (bearer === "company" && client !== 0) throw new Error("Part client interdite lorsque l’entreprise supporte les frais");
  if (bearer === "client" && company !== 0) throw new Error("Part entreprise interdite lorsque le client supporte les frais");
  if (bearer === "shared" && (company <= 0 || client <= 0)) throw new Error("Un frais partagé doit préciser les deux parts");
}

export function assertExpenseNature(nature: string, usefulLife?: number) {
  if (nature === "fixed_asset" && (!usefulLife || usefulLife <= 0)) throw new Error("Durée d'utilisation obligatoire pour une immobilisation.");
}
