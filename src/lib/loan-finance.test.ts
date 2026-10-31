import { describe, expect, it } from "vitest";
import { buildLoanSchedule } from "./loan-finance";

describe("buildLoanSchedule", () => {
  it("builds a constant-annuity schedule and fully repays the principal", () => {
    const result = buildLoanSchedule({
      principal: 60_000_000,
      annualRatePercent: 10,
      periods: 24,
      paymentsPerYear: 12,
      firstDueDate: "2026-11-13",
      method: "annuity",
    });

    expect(result.installments).toHaveLength(24);
    expect(result.installments[0].interest).toBe(500_000);
    expect(result.installments.at(-1)?.closingPrincipal).toBe(0);
    expect(result.installments.reduce((sum, row) => sum + row.principal, 0)).toBe(60_000_000);
    expect(result.totalPayments).toBe(result.principal + result.totalInterest);
  });

  it("supports a zero-interest loan without division errors", () => {
    const result = buildLoanSchedule({
      principal: 1_000,
      annualRatePercent: 0,
      periods: 4,
      paymentsPerYear: 12,
      firstDueDate: "2026-01-31",
      method: "annuity",
    });

    expect(result.totalInterest).toBe(0);
    expect(result.installments.map((row) => row.principal)).toEqual([250, 250, 250, 250]);
    expect(result.installments.at(-1)?.closingPrincipal).toBe(0);
  });

  it("supports equal-principal repayments", () => {
    const result = buildLoanSchedule({
      principal: 1_000,
      annualRatePercent: 12,
      periods: 4,
      paymentsPerYear: 12,
      firstDueDate: "2026-01-15",
      method: "equal_principal",
    });

    expect(result.installments.map((row) => row.principal)).toEqual([250, 250, 250, 250]);
    expect(result.installments.map((row) => row.interest)).toEqual([10, 7.5, 5, 2.5]);
  });

  it("supports bullet repayment with interest paid each period", () => {
    const result = buildLoanSchedule({
      principal: 10_000,
      annualRatePercent: 12,
      periods: 3,
      paymentsPerYear: 12,
      firstDueDate: "2026-01-01",
      method: "bullet",
    });

    expect(result.installments.map((row) => row.principal)).toEqual([0, 0, 10_000]);
    expect(result.installments.map((row) => row.interest)).toEqual([100, 100, 100]);
  });

  it("clamps month-end dates instead of overflowing into the next month", () => {
    const result = buildLoanSchedule({
      principal: 300,
      annualRatePercent: 0,
      periods: 3,
      paymentsPerYear: 12,
      firstDueDate: "2026-01-31",
      method: "equal_principal",
    });

    expect(result.installments.map((row) => row.dueDate)).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
    ]);
  });

  it("rejects invalid inputs", () => {
    expect(() => buildLoanSchedule({
      principal: 0,
      annualRatePercent: 10,
      periods: 12,
      paymentsPerYear: 12,
      firstDueDate: "2026-01-01",
      method: "annuity",
    })).toThrow("capital");
  });
});
