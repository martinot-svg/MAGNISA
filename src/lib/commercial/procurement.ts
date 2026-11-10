export const PURCHASE_PURPOSES = [
  "resale",
  "customer_mandate",
  "company_use",
  "consumption",
] as const;

export type PurchasePurpose = (typeof PURCHASE_PURPOSES)[number];
export type ItemTrackingMode = "none" | "quantity" | "serial";

export interface PurchaseOrderLineInput {
  purpose: PurchasePurpose;
  itemId?: string | null;
  beneficiaryCustomerId?: string | null;
  mandateEvidence?: {
    mandateConfirmed: boolean;
    supplierDocumentNamesCustomer: boolean;
    companyBearsGoodsRisk: boolean;
    exactCostSupported: boolean;
    supplierDocumentReference?: string | null;
  };
  quantityOrdered: number;
}

export interface GoodsReceiptInput {
  quantityOrdered: number;
  quantityPreviouslyReceived: number;
  quantityInThisReceipt: number;
}

export type ReceiptStockEffect =
  | { kind: "increase"; reason: string }
  | { kind: "none"; reason: string }
  | { kind: "blocked"; reason: string };

export function validatePurchaseOrderLine(input: PurchaseOrderLineInput): string[] {
  const errors: string[] = [];
  if (!Number.isFinite(input.quantityOrdered) || input.quantityOrdered <= 0) {
    errors.push("Ordered quantity must be greater than zero.");
  }
  if (!input.itemId) {
    errors.push("A physical purchase line must reference a catalogue item.");
  }
  if (input.purpose === "customer_mandate" && !input.beneficiaryCustomerId) {
    errors.push("A customer mandate must identify the beneficiary customer.");
  }
  if (input.purpose !== "customer_mandate" && input.beneficiaryCustomerId) {
    errors.push("A beneficiary customer is only valid for a customer mandate.");
  }
  if (input.purpose === "customer_mandate") {
    const evidence = input.mandateEvidence;
    if (
      !evidence?.mandateConfirmed ||
      !evidence.supplierDocumentNamesCustomer ||
      evidence.companyBearsGoodsRisk ||
      !evidence.exactCostSupported ||
      !evidence.supplierDocumentReference?.trim()
    ) {
      errors.push("A customer mandate requires documented authorization, a supplier document in the customer's name, no company goods risk and exact-cost evidence.");
    }
  }
  return errors;
}

export function classifyReceiptStockEffect(
  purpose: PurchasePurpose,
  trackingMode: ItemTrackingMode,
): ReceiptStockEffect {
  if (purpose === "customer_mandate") {
    return { kind: "none", reason: "The goods belong to the customer and are not company inventory." };
  }
  if (purpose === "resale" && trackingMode === "none") {
    return { kind: "blocked", reason: "Goods acquired for resale must be quantity-tracked." };
  }
  if (trackingMode === "serial") {
    return { kind: "blocked", reason: "Serial number capture is not yet supported by this receipt workflow." };
  }
  if (trackingMode === "none") {
    return { kind: "none", reason: "This item is configured as non-stock." };
  }
  return { kind: "increase", reason: "The receipt increases the company's physical stock." };
}

export function validateGoodsReceiptQuantity(input: GoodsReceiptInput): string[] {
  const errors: string[] = [];
  const values = [
    input.quantityOrdered,
    input.quantityPreviouslyReceived,
    input.quantityInThisReceipt,
  ];
  if (values.some((value) => !Number.isFinite(value))) {
    return ["Receipt quantities must be finite numbers."];
  }
  if (input.quantityOrdered <= 0 || input.quantityPreviouslyReceived < 0 || input.quantityInThisReceipt <= 0) {
    errors.push("Ordered and receipt quantities must be positive; previously received quantity cannot be negative.");
  }
  if (input.quantityPreviouslyReceived + input.quantityInThisReceipt > input.quantityOrdered + 1e-8) {
    errors.push("Receipt quantity exceeds the remaining ordered quantity.");
  }
  return errors;
}

export function derivePurchaseOrderStatus(
  lines: Array<{ quantityOrdered: number; quantityReceived: number }>,
): "draft" | "submitted" | "partially_received" | "received" {
  if (lines.length === 0) return "draft";
  if (lines.some((line) => line.quantityReceived < 0 || line.quantityOrdered <= 0 || line.quantityReceived > line.quantityOrdered + 1e-8)) {
    throw new Error("Purchase order quantities are inconsistent.");
  }
  if (lines.every((line) => Math.abs(line.quantityReceived - line.quantityOrdered) <= 1e-8)) return "received";
  if (lines.some((line) => line.quantityReceived > 0)) return "partially_received";
  return "submitted";
}
