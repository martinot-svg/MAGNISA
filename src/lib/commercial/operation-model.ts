/**
 * Commercial event classification. This layer classifies economic substance;
 * the versioned PCG posting engine remains the only authority for journals.
 */
export const OPERATION_FAMILIES = [
  "service_delivery", "merchandise_trade", "third_party_mandate",
  "customer_supplied_goods", "mixed_supply", "procurement", "inventory",
  "subcontracting", "rental", "recurring_contract", "customer_advance",
  "supplier_advance", "guarantee", "return_after_sales",
  "reimbursable_expense", "foreign_currency", "internal_transfer",
] as const;
export type OperationFamily = (typeof OPERATION_FAMILIES)[number];

export type CommercialLineNature =
  | "service" | "merchandise" | "third_party_purchase" | "customer_supplied"
  | "consumable_supply" | "subcontracted_service" | "rental_income"
  | "rental_expense" | "customer_advance" | "supplier_advance"
  | "refundable_deposit" | "guarantee" | "reimbursable_disbursement"
  | "foreign_currency" | "internal_transfer";
export type PartyCapacity = "principal" | "agent" | "unknown";
export type GoodsOwner = "company" | "customer" | "supplier" | "unknown";
export type PurchaseDestination = "resale" | "customer_delivery" | "company_use" | "consumption" | "unknown";
export type AccountingTreatment =
  | "service_revenue" | "merchandise_sale_and_stock" | "third_party_clearing"
  | "customer_owned_no_goods_posting" | "expense_or_consumption"
  | "subcontracting_expense" | "rental_income" | "rental_expense"
  | "customer_advance_liability" | "supplier_advance_asset"
  | "refundable_deposit_liability" | "guarantee_tracking"
  | "reimbursable_third_party_clearing" | "foreign_currency_revaluation_review"
  | "internal_transfer_clearing" | "manual_accounting_review";

export interface MandateEvidence {
  mandateConfirmed: boolean;
  supplierDocumentNamesCustomer: boolean;
  companyBearsGoodsRisk: boolean;
  exactCostSupported: boolean;
}
export interface CommercialLineInput {
  nature: CommercialLineNature;
  capacity?: PartyCapacity;
  goodsOwner?: GoodsOwner;
  purchaseDestination?: PurchaseDestination;
  mandate?: MandateEvidence;
  reimbursementIsExact?: boolean;
  separatelyPricedServiceFee?: boolean;
  customerRetainsOwnership?: boolean;
}
export interface CommercialClassification {
  treatment: AccountingTreatment;
  requiresStockMovement: boolean;
  revenueNature: "service" | "merchandise" | "none" | "review";
  requiresThirdPartyReconciliation: boolean;
  requiresEvidence: string[];
  reviewReasons: string[];
}
const review = (reason: string): CommercialClassification => ({
  treatment: "manual_accounting_review",
  requiresStockMovement: false,
  revenueNature: "review",
  requiresThirdPartyReconciliation: false,
  requiresEvidence: [],
  reviewReasons: [reason],
});

export function classifyCommercialLine(input: CommercialLineInput): CommercialClassification {
  switch (input.nature) {
    case "service":
      return { treatment: "service_revenue", requiresStockMovement: false, revenueNature: "service",
        requiresThirdPartyReconciliation: false, requiresEvidence: ["customer_contract_or_service_order", "service_completion_evidence"], reviewReasons: [] };
    case "merchandise":
      if (input.capacity === "agent" || input.goodsOwner === "customer") return review("A merchandise sale conflicts with an agent role or customer ownership; classify the legal transaction first.");
      if (input.capacity === "unknown" || input.goodsOwner === "unknown" || !input.capacity || !input.goodsOwner) return review("The seller capacity or ownership of the goods is not established.");
      return { treatment: "merchandise_sale_and_stock", requiresStockMovement: true, revenueNature: "merchandise",
        requiresThirdPartyReconciliation: false, requiresEvidence: ["supplier_invoice", "goods_receipt", "customer_delivery_or_transfer"], reviewReasons: [] };
    case "third_party_purchase": {
      const m = input.mandate;
      if (!m || !m.mandateConfirmed || !m.supplierDocumentNamesCustomer || m.companyBearsGoodsRisk || !m.exactCostSupported)
        return review("The documented mandate, supplier document in the customer's name, absence of company goods risk and exact-cost evidence must all be present.");
      return { treatment: "third_party_clearing", requiresStockMovement: false, revenueNature: "none",
        requiresThirdPartyReconciliation: true, requiresEvidence: ["customer_mandate", "supplier_document_in_customer_name", "proof_of_customer_funds", "supplier_payment_proof", "exact_cost_reconciliation"], reviewReasons: [] };
    }
    case "customer_supplied":
      if (input.customerRetainsOwnership !== true || input.goodsOwner !== "customer") return review("Customer-supplied goods require confirmation that the customer retains ownership.");
      return { treatment: "customer_owned_no_goods_posting", requiresStockMovement: false, revenueNature: "none",
        requiresThirdPartyReconciliation: false, requiresEvidence: ["customer_goods_handover", "return_or_installation_record"], reviewReasons: [] };
    case "consumable_supply":
      if (input.purchaseDestination !== "consumption") return review("Supplies must be classified by their actual destination before expense recognition.");
      return { treatment: "expense_or_consumption", requiresStockMovement: false, revenueNature: "none",
        requiresThirdPartyReconciliation: false, requiresEvidence: ["supplier_invoice", "consumption_or_issue_evidence"], reviewReasons: [] };
    case "subcontracted_service":
      return { treatment: "subcontracting_expense", requiresStockMovement: false, revenueNature: "none",
        requiresThirdPartyReconciliation: false, requiresEvidence: ["subcontractor_order_or_contract", "subcontractor_invoice", "service_acceptance"], reviewReasons: [] };
    case "rental_income":
      return { treatment: "rental_income", requiresStockMovement: false, revenueNature: "service",
        requiresThirdPartyReconciliation: false, requiresEvidence: ["rental_contract", "period_of_use", "handover_or_return_record"], reviewReasons: [] };
    case "rental_expense":
      return { treatment: "rental_expense", requiresStockMovement: false, revenueNature: "none",
        requiresThirdPartyReconciliation: false, requiresEvidence: ["rental_contract", "period_of_use", "supplier_invoice"], reviewReasons: [] };
    case "customer_advance":
      return { treatment: "customer_advance_liability", requiresStockMovement: false, revenueNature: "none",
        requiresThirdPartyReconciliation: false, requiresEvidence: ["customer_order_or_contract", "receipt"], reviewReasons: [] };
    case "supplier_advance":
      return { treatment: "supplier_advance_asset", requiresStockMovement: false, revenueNature: "none",
        requiresThirdPartyReconciliation: false, requiresEvidence: ["supplier_order", "payment_proof"], reviewReasons: [] };
    case "refundable_deposit":
      return { treatment: "refundable_deposit_liability", requiresStockMovement: false, revenueNature: "none",
        requiresThirdPartyReconciliation: false, requiresEvidence: ["contractual_deposit_clause", "receipt", "refund_or_retention_evidence"], reviewReasons: [] };
    case "guarantee":
      return { treatment: "guarantee_tracking", requiresStockMovement: false, revenueNature: "none",
        requiresThirdPartyReconciliation: false, requiresEvidence: ["warranty_or_guarantee_terms", "delivery_record", "claim_or_expiry_record"], reviewReasons: [] };
    case "reimbursable_disbursement":
      if (input.reimbursementIsExact === true && input.capacity === "agent")
        return { treatment: "reimbursable_third_party_clearing", requiresStockMovement: false, revenueNature: "none",
          requiresThirdPartyReconciliation: true, requiresEvidence: ["customer_authorization", "third_party_receipt", "exact_reimbursement_reconciliation"], reviewReasons: [] };
      if (input.separatelyPricedServiceFee === true)
        return { treatment: "service_revenue", requiresStockMovement: false, revenueNature: "service",
          requiresThirdPartyReconciliation: false, requiresEvidence: ["customer_contract", "invoice", "expense_evidence"], reviewReasons: [] };
      return review("Distinguish an exact third-party reimbursement from a separately priced service fee and retain evidence.");
    case "foreign_currency":
      return { treatment: "foreign_currency_revaluation_review", requiresStockMovement: false, revenueNature: "review",
        requiresThirdPartyReconciliation: false, requiresEvidence: ["source_currency_amount", "exchange_rate_source", "transaction_date", "settlement_date"],
        reviewReasons: ["Apply configured PCG foreign-currency rules and period-end revaluation; currency alone does not determine the journal."] };
    case "internal_transfer":
      return { treatment: "internal_transfer_clearing", requiresStockMovement: false, revenueNature: "none",
        requiresThirdPartyReconciliation: false, requiresEvidence: ["source_account", "destination_account", "transfer_reference"], reviewReasons: [] };
  }
}

export interface OperationEventIdentity {
  organizationId: string;
  operationId: string;
  eventType: string;
  idempotencyKey: string;
}
export function validateOperationEventIdentity(value: OperationEventIdentity): string[] {
  const errors: string[] = [];
  if (!value.organizationId.trim()) errors.push("organizationId is required");
  if (!value.operationId.trim()) errors.push("operationId is required");
  if (!value.eventType.trim()) errors.push("eventType is required");
  if (!value.idempotencyKey.trim()) errors.push("idempotencyKey is required");
  return errors;
}
