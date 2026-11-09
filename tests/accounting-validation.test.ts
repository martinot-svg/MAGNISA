import { describe, expect, it } from "vitest";
import { assertExpenseNature, assertFeeBearer, expenseInputSchema, supplierPaymentInputSchema } from "../src/server/accounting-validation";
import { isPcgMappingAllowed, suggestPcgCode } from "../src/lib/accounting/pcg-mapping";

const uuid = "00000000-0000-4000-8000-000000000001";
const expense = { description: "Abonnement logiciel", amount: "1000", expense_date: "2026-10-22", financial_account_id: uuid, category: "604", expense_nature: "expense", supplier_id: "", document_reference: "FAC-1", useful_life_months: "", fee_amount: "100", fee_company_amount: "100", fee_client_amount: "0", fee_bearer: "company", idempotency_key: uuid };
const payment = { supplier_invoice_id: uuid, financial_account_id: uuid, amount: "1000", payment_date: "2026-10-22", method: "mobile_money", reference: "PAY-1", idempotency_key: uuid, fee_amount: "100", fee_company_amount: "100", fee_client_amount: "0", fee_bearer: "company" };

describe("MAGNISA accounting input contract", () => {
  it("accepts an immediate expense with company fee", () => expect(expenseInputSchema.safeParse(expense).success).toBe(true));
  it("accepts a supplier payment with fee", () => expect(supplierPaymentInputSchema.safeParse(payment).success).toBe(true));
  it("rejects an unbalanced fee split", () => expect(() => assertFeeBearer("company", 100, 90, 0)).toThrow());
  it("rejects client share when company bears the fee", () => expect(() => assertFeeBearer("company", 100, 50, 50)).toThrow());
  it("rejects company share when client bears the fee", () => expect(() => assertFeeBearer("client", 100, 50, 50)).toThrow());
  it("requires both sides for shared fees", () => expect(() => assertFeeBearer("shared", 100, 100, 0)).toThrow());
  it("rejects a non-zero fee when bearer is none", () => expect(() => assertFeeBearer("none", 1, 0, 1)).toThrow());
  it("requires useful life for fixed assets", () => expect(() => assertExpenseNature("fixed_asset")).toThrow());
  it("accepts useful life for fixed assets", () => expect(() => assertExpenseNature("fixed_asset", 48)).not.toThrow());
  it("rejects invalid supplier payment methods", () => expect(supplierPaymentInputSchema.safeParse({ ...payment, method: "crypto" }).success).toBe(false));
  it("rejects non-positive expense amounts", () => expect(expenseInputSchema.safeParse({ ...expense, amount: "0" }).success).toBe(false));
  it("rejects malformed idempotency keys", () => expect(expenseInputSchema.safeParse({ ...expense, idempotency_key: "bad" }).success).toBe(false));
  it("does not infer fixed-asset accounts from computer descriptions", () => expect(suggestPcgCode("Ordinateur portable", "EXPENSE:acquisition")).toBe(""));
  it("does not infer fixed-asset accounts from generic supplier expenses", () => expect(suggestPcgCode("Achats et sous-traitance", "EXPENSE:SUPPLIER")).toBe(""));
  it("suggests PCG 581 for explicitly identified transit accounts", () => expect(suggestPcgCode("Fonds en transit", "TRANSIT:transfer-id")).toBe("581"));
  it("keeps the narrow MVola suspense-account suggestion", () => expect(suggestPcgCode("Frais MVola à reclasser", "471")).toBe("471"));
  it("rejects generic expense mappings to fixed-asset accounts", () => expect(isPcgMappingAllowed("EXPENSE:acquisition", "asset")).toBe(false));
  it("rejects generic expense mappings to equity accounts", () => expect(isPcgMappingAllowed("EXPENSE:transport", "equity")).toBe(false));
  it("allows expense mappings to expense accounts", () => expect(isPcgMappingAllowed("EXPENSE:transport", "expense")).toBe(true));
});
