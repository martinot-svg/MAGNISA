import { describe, expect, it } from "vitest";
import { classifyCommercialLine, validateOperationEventIdentity } from "./operation-model";

describe("classifyCommercialLine", () => {
  it("classifies service revenue without stock", () => {
    expect(classifyCommercialLine({ nature: "service" })).toMatchObject({
      treatment: "service_revenue", requiresStockMovement: false, revenueNature: "service",
    });
  });
  it("classifies principal-owned resale goods as merchandise and stock", () => {
    expect(classifyCommercialLine({ nature: "merchandise", capacity: "principal", goodsOwner: "company", purchaseDestination: "resale" })).toMatchObject({
      treatment: "merchandise_sale_and_stock", requiresStockMovement: true, revenueNature: "merchandise",
    });
  });
  it("requires evidence before classifying a purchase as a mandate", () => {
    expect(classifyCommercialLine({ nature: "third_party_purchase" }).treatment).toBe("manual_accounting_review");
    expect(classifyCommercialLine({ nature: "third_party_purchase", capacity: "agent", mandate: {
      mandateConfirmed: true, supplierDocumentNamesCustomer: true, companyBearsGoodsRisk: false, exactCostSupported: true,
    } })).toMatchObject({ treatment: "third_party_clearing", requiresThirdPartyReconciliation: true, revenueNature: "none" });
  });
  it("does not net a purchase as a mandate when the supplier document names the company", () => {
    expect(classifyCommercialLine({ nature: "third_party_purchase", capacity: "agent", mandate: {
      mandateConfirmed: true, supplierDocumentNamesCustomer: false, companyBearsGoodsRisk: false, exactCostSupported: true,
    } }).treatment).toBe("manual_accounting_review");
  });
  it("keeps customer-owned goods outside company stock", () => {
    expect(classifyCommercialLine({ nature: "customer_supplied", goodsOwner: "customer", customerRetainsOwnership: true })).toMatchObject({
      treatment: "customer_owned_no_goods_posting", requiresStockMovement: false, revenueNature: "none",
    });
  });
  it("requires consumption destination before expensing supplies", () => {
    expect(classifyCommercialLine({ nature: "consumable_supply", purchaseDestination: "unknown" }).treatment).toBe("manual_accounting_review");
    expect(classifyCommercialLine({ nature: "consumable_supply", purchaseDestination: "consumption" }).treatment).toBe("expense_or_consumption");
  });
  it("distinguishes exact mandate reimbursements from service fees", () => {
    expect(classifyCommercialLine({ nature: "reimbursable_disbursement", capacity: "agent", reimbursementIsExact: true }).treatment).toBe("reimbursable_third_party_clearing");
    expect(classifyCommercialLine({ nature: "reimbursable_disbursement", separatelyPricedServiceFee: true }).treatment).toBe("service_revenue");
  });
  it("keeps advances, refundable deposits and guarantees outside revenue", () => {
    for (const nature of ["customer_advance", "refundable_deposit", "guarantee"] as const)
      expect(classifyCommercialLine({ nature }).revenueNature).toBe("none");
  });
  it("validates event identity and mandatory idempotency key", () => {
    expect(validateOperationEventIdentity({ organizationId: "", operationId: "op-1", eventType: "delivery", idempotencyKey: "" }))
      .toEqual(["organizationId is required", "idempotencyKey is required"]);
  });
});
