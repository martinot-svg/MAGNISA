import { describe, expect, it } from "vitest";
import { isFiscalStatementReady, type FiscalStatementReadinessInput } from "./fiscal-statements";

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
};

describe("isFiscalStatementReady",()=>{
  it("accepts only a closed and fully controlled statement set",()=>{
    expect(isFiscalStatementReady(valid)).toBe(true);
  });
  it("blocks finalization while the operating cash flow bridge is missing",()=>{
    expect(isFiscalStatementReady({...valid,operatingCashFlowReconciliationReady:false})).toBe(false);
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
