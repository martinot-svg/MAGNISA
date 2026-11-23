import { describe, expect, it } from "vitest";
import { classifyCashFlowJournalEntry, classifyCashFlowCounterpart, isBalanceSheetReady, isFiscalStatementReady, isInventoryCountReady, isLoanRepaymentEffectiveAtDate, isObligationBalanceReconstructable, taxSocialObligationAccountCode, type FiscalStatementReadinessInput } from "./fiscal-statements";

const valid: FiscalStatementReadinessInput = {
  isClosed:true,
  unmapped:0,
  unbalancedEntries:0,
  unclassifiedCashFlowEntries:0,
  cashFlowReconciliationDifference:0,
  balanceDifference:0,
  notesReady:true,
  operatingCashFlowReconciliationReady:true,
  pcgPresentationReady:true,
  assetPresentationReady:true,
  passifPresentationReady:true,
};


describe("isBalanceSheetReady",()=>{
  const validBalance={
    isClosed:true,unmapped:0,unbalancedEntries:0,balanceDifference:0,
    assetPresentationReady:true,passifPresentationReady:true,
  };
  it("accepts a closed balance sheet when both sides and all reconciliations are valid",()=>{
    expect(isBalanceSheetReady(validBalance)).toBe(true);
  });
  it("blocks an open fiscal year",()=>{
    expect(isBalanceSheetReady({...validBalance,isClosed:false})).toBe(false);
  });
  it("blocks unmapped accounts and unbalanced entries",()=>{
    expect(isBalanceSheetReady({...validBalance,unmapped:1})).toBe(false);
    expect(isBalanceSheetReady({...validBalance,unbalancedEntries:1})).toBe(false);
  });
  it("blocks any non-zero asset/passif difference at cent precision",()=>{
    expect(isBalanceSheetReady({...validBalance,balanceDifference:0.01})).toBe(false);
    expect(isBalanceSheetReady({...validBalance,balanceDifference:0.009})).toBe(true);
  });
  it("blocks an incomplete asset or passif presentation",()=>{
    expect(isBalanceSheetReady({...validBalance,assetPresentationReady:false})).toBe(false);
    expect(isBalanceSheetReady({...validBalance,passifPresentationReady:false})).toBe(false);
  });
});

describe("isFiscalStatementReady",()=>{
  it("accepts only a closed and fully controlled statement set",()=>{
    expect(isFiscalStatementReady(valid)).toBe(true);
  });
  it("blocks finalization while the operating cash flow bridge is missing",()=>{
    expect(isFiscalStatementReady({...valid,operatingCashFlowReconciliationReady:false})).toBe(false);
  });
  it("blocks finalization while the active side is not validated",()=>{
    expect(isFiscalStatementReady({...valid,assetPresentationReady:false})).toBe(false);
  });
  it("blocks finalization while the passif side is not validated",()=>{
    expect(isFiscalStatementReady({...valid,passifPresentationReady:false})).toBe(false);
  });
  it("blocks finalization while PCG presentation classifications are missing",()=>{
    expect(isFiscalStatementReady({...valid,pcgPresentationReady:false})).toBe(false);
  });
  it("blocks finalization when cash entries remain unclassified",()=>{
    expect(isFiscalStatementReady({...valid,unclassifiedCashFlowEntries:1})).toBe(false);
  });
  it("blocks finalization when the cash movement does not reconcile",()=>{
    expect(isFiscalStatementReady({...valid,cashFlowReconciliationDifference:1})).toBe(false);
  });
  it("blocks finalization when the balance sheet does not balance",()=>{
    expect(isFiscalStatementReady({...valid,balanceDifference:1})).toBe(false);
  });
});

describe("classifyCashFlowCounterpart",()=>{
  it("classifies fixed-asset supplier and disposal receivable settlements as investing",()=>{
    expect(classifyCashFlowCounterpart("404")).toBe("investing");
    expect(classifyCashFlowCounterpart("405")).toBe("investing");
    expect(classifyCashFlowCounterpart("462")).toBe("investing");
  });
  it("preserves operating and financing classifications for unrelated accounts",()=>{
    expect(classifyCashFlowCounterpart("401")).toBe("operating");
    expect(classifyCashFlowCounterpart("164")).toBe("financing");
    expect(classifyCashFlowCounterpart("516")).toBe("financing");
  });
  it("keeps cash and internal-transfer accounts out of counterpart classification",()=>{
    expect(classifyCashFlowCounterpart("512")).toBeNull();
    expect(classifyCashFlowCounterpart("53")).toBeNull();
    expect(classifyCashFlowCounterpart("581")).toBeNull();
  });
  it("preserves investing classifications for PCG subaccounts",()=>{
    expect(classifyCashFlowCounterpart("4041")).toBe("investing");
    expect(classifyCashFlowCounterpart("4051")).toBe("investing");
    expect(classifyCashFlowCounterpart("4621")).toBe("investing");
  });
  it("does not misclassify inventory impairment accounts as operating",()=>{
    expect(classifyCashFlowCounterpart("39")).toBeNull();
    expect(classifyCashFlowCounterpart("391")).toBeNull();
  });
  it("does not misclassify inter-entity, suspense, accrual or impairment accounts as operating",()=>{
    expect(classifyCashFlowCounterpart("451")).toBeNull();
    expect(classifyCashFlowCounterpart("471")).toBeNull();
    expect(classifyCashFlowCounterpart("486")).toBeNull();
    expect(classifyCashFlowCounterpart("491")).toBeNull();
  });
  it("keeps ordinary third-party control accounts operating",()=>{
    expect(classifyCashFlowCounterpart("401")).toBe("operating");
    expect(classifyCashFlowCounterpart("411")).toBe("operating");
    expect(classifyCashFlowCounterpart("431")).toBe("operating");
    expect(classifyCashFlowCounterpart("445")).toBe("operating");
  });
  it("does not classify unsupported account families by guessing",()=>{
    expect(classifyCashFlowCounterpart("501")).toBeNull();
    expect(classifyCashFlowCounterpart("80")).toBeNull();
    expect(classifyCashFlowCounterpart("")).toBeNull();
  });
});


describe("classifyCashFlowJournalEntry", () => {
  it("accepts several counterpart lines in the same category when the entry balances", () => {
    expect(classifyCashFlowJournalEntry([
      {pcg_code:"512",debit:0,credit:100},
      {pcg_code:"401",debit:60,credit:0},
      {pcg_code:"445",debit:40,credit:0},
    ])).toEqual({bucket:"operating",cashAmount:-100});
  });
  it("rejects mixed categories, unmapped counterparts and unbalanced entries", () => {
    expect(classifyCashFlowJournalEntry([
      {pcg_code:"512",debit:100,credit:0},
      {pcg_code:"401",debit:0,credit:70},
      {pcg_code:"404",debit:0,credit:30},
    ])).toBeNull();
    expect(classifyCashFlowJournalEntry([
      {pcg_code:"512",debit:100,credit:0},
      {pcg_code:null,debit:0,credit:100},
    ])).toBeNull();
    expect(classifyCashFlowJournalEntry([
      {pcg_code:"512",debit:100,credit:0},
      {pcg_code:"401",debit:0,credit:99},
    ])).toBeNull();
  });
  it("ignores fiscal-year opening entries", () => {
    expect(classifyCashFlowJournalEntry([
      {pcg_code:"512",debit:100,credit:0,source_type:"fiscal_year_opening"},
    ])).toBeNull();
  });
});

describe("isLoanRepaymentEffectiveAtDate", () => {
  it("includes posted principal repayments made by fiscal close", () => {
    expect(isLoanRepaymentEffectiveAtDate("posted", "2026-06-30", null, "2026-12-31")).toBe(true);
  });
  it("excludes repayments made after fiscal close", () => {
    expect(isLoanRepaymentEffectiveAtDate("posted", "2027-01-02", null, "2026-12-31")).toBe(false);
  });
  it("keeps a repayment reversed only after fiscal close in the historical closing balance", () => {
    expect(isLoanRepaymentEffectiveAtDate("reversed", "2026-06-30", "2027-02-01", "2026-12-31")).toBe(true);
  });
  it("excludes a repayment reversed on or before fiscal close", () => {
    expect(isLoanRepaymentEffectiveAtDate("reversed", "2026-06-30", "2026-12-30", "2026-12-31")).toBe(false);
  });
  it("does not count draft or pending repayments", () => {
    expect(isLoanRepaymentEffectiveAtDate("pending", "2026-06-30", null, "2026-12-31")).toBe(false);
    expect(isLoanRepaymentEffectiveAtDate("draft", "2026-06-30", null, "2026-12-31")).toBe(false);
  });
});


describe("isInventoryCountReady", () => {
  it("does not require an inventory count when the ledger has no stock balance", () => {
    expect(isInventoryCountReady({
      inventoryAvailable:true,hasStockBalance:false,hasApprovedCount:false,
      grossLedgerGap:0,impairmentLedgerGap:0,
    })).toBe(true);
  });
  it("requires an approved count when stock accounts carry a balance", () => {
    expect(isInventoryCountReady({
      inventoryAvailable:true,hasStockBalance:true,hasApprovedCount:false,
      grossLedgerGap:0,impairmentLedgerGap:0,
    })).toBe(false);
  });
  it("requires both gross and impairment balances to reconcile", () => {
    expect(isInventoryCountReady({
      inventoryAvailable:true,hasStockBalance:true,hasApprovedCount:true,
      grossLedgerGap:0.02,impairmentLedgerGap:0,
    })).toBe(false);
    expect(isInventoryCountReady({
      inventoryAvailable:true,hasStockBalance:true,hasApprovedCount:true,
      grossLedgerGap:0,impairmentLedgerGap:0,
    })).toBe(true);
  });
  it("blocks when the inventory valuation service is unavailable", () => {
    expect(isInventoryCountReady({
      inventoryAvailable:false,hasStockBalance:false,hasApprovedCount:false,
      grossLedgerGap:0,impairmentLedgerGap:0,
    })).toBe(false);
  });
});


describe("taxSocialObligationAccountCode", () => {
  it("maps known tax obligations to the PCG control accounts", () => {
    expect(taxSocialObligationAccountCode("tax","TVA")).toBe("445");
    expect(taxSocialObligationAccountCode("tax","IRSA")).toBe("442");
    expect(taxSocialObligationAccountCode("tax","IS")).toBeNull();
  });
  it("maps CNaPS and OSTIE obligations to social payable account 431", () => {
    expect(taxSocialObligationAccountCode("social","CNaPS")).toBe("431");
    expect(taxSocialObligationAccountCode("social","OSTIE")).toBe("431");
    expect(taxSocialObligationAccountCode("social","OTHER")).toBeNull();
  });
});

describe("isObligationBalanceReconstructable", () => {
  it("accepts only open or overdue obligations without recorded payments", () => {
    expect(isObligationBalanceReconstructable("open",0)).toBe(true);
    expect(isObligationBalanceReconstructable("overdue",0)).toBe(true);
    expect(isObligationBalanceReconstructable("paid",0)).toBe(false);
    expect(isObligationBalanceReconstructable("open",100)).toBe(false);
  });
});
