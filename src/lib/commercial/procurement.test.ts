import { describe, expect, it } from "vitest";
import {
  calculatePurchaseLineTotals,
  classifyReceiptStockEffect,
  derivePurchaseOrderStatus,
  validateGoodsReceiptQuantity,
  validatePurchaseOrderLine,
} from "./procurement";

describe("procurement classification", () => {
  it("accepts a company purchase for resale as a catalogue item", () => {
    expect(validatePurchaseOrderLine({
      purpose: "resale", itemId: "item-1", quantityOrdered: 2,
    })).toEqual([]);
    expect(classifyReceiptStockEffect("resale", "quantity").kind).toBe("increase");
  });

  it("keeps customer mandate goods out of company inventory", () => {
    expect(validatePurchaseOrderLine({
      purpose: "customer_mandate", itemId: "starlink-kit", beneficiaryCustomerId: "customer-1", quantityOrdered: 1,
      mandateEvidence: {
        mandateConfirmed: true, supplierDocumentNamesCustomer: true, companyBearsGoodsRisk: false,
        exactCostSupported: true, supplierDocumentReference: "SUPPLIER-INVOICE-001",
      },
    })).toEqual([]);
    expect(classifyReceiptStockEffect("customer_mandate", "quantity")).toMatchObject({ kind: "none" });
  });

  it("requires the beneficiary and documentary evidence for a customer mandate", () => {
    expect(validatePurchaseOrderLine({
      purpose: "customer_mandate", itemId: "kit", quantityOrdered: 1,
    })).toContain("A customer mandate must identify the beneficiary customer.");
    expect(validatePurchaseOrderLine({
      purpose: "customer_mandate", itemId: "kit", beneficiaryCustomerId: "customer-1", quantityOrdered: 1,
    })).toContain("A customer mandate requires documented authorization, a supplier document in the customer's name, no company goods risk and exact-cost evidence.");
  });

  it("blocks resale items configured as non-stock", () => {
    expect(classifyReceiptStockEffect("resale", "none").kind).toBe("blocked");
  });

  it("rejects over-receipt but allows partial receipt", () => {
    expect(validateGoodsReceiptQuantity({
      quantityOrdered: 10, quantityPreviouslyReceived: 0, quantityInThisReceipt: 4,
    })).toEqual([]);
    expect(validateGoodsReceiptQuantity({
      quantityOrdered: 10, quantityPreviouslyReceived: 8, quantityInThisReceipt: 3,
    })).toContain("Receipt quantity exceeds the remaining ordered quantity.");
  });

  it("handles decimal quantities without floating-point over-receipt", () => {
    expect(validateGoodsReceiptQuantity({
      quantityOrdered: 0.3, quantityPreviouslyReceived: 0.1, quantityInThisReceipt: 0.2,
    })).toEqual([]);
  });

  it("derives submitted, partial and received states from quantities", () => {
    expect(derivePurchaseOrderStatus([{ quantityOrdered: 5, quantityReceived: 0 }])).toBe("submitted");
    expect(derivePurchaseOrderStatus([{ quantityOrdered: 5, quantityReceived: 2 }])).toBe("partially_received");
    expect(derivePurchaseOrderStatus([{ quantityOrdered: 5, quantityReceived: 5 }])).toBe("received");
  });

  it("rejects inconsistent received quantities", () => {
    expect(() => derivePurchaseOrderStatus([{ quantityOrdered: 5, quantityReceived: 6 }])).toThrow();
  });
});

describe("purchase line amount calculation", () => {
  it("applies discount and allocated costs before calculating tax", () => {
    expect(calculatePurchaseLineTotals({
      quantity: 2, unitPrice: 1000, discountAmount: 100,
      additionalCostAmount: 50, taxRate: 20,
    })).toEqual({
      grossAmount: 2000, discountAmount: 100, additionalCostAmount: 50,
      taxableBase: 1950, taxAmount: 390, totalAmount: 2340,
    });
  });

  it("rejects discounts greater than the gross line amount", () => {
    expect(() => calculatePurchaseLineTotals({
      quantity: 1, unitPrice: 100, discountAmount: 101,
      additionalCostAmount: 0, taxRate: 20,
    })).toThrow("The discount exceeds the gross purchase line.");
  });
});
