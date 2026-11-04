import { describe, expect, it } from "vitest";
import { addMonthsClamped, buildLoanSchedule } from "./loan-finance";

describe("buildLoanSchedule", () => {
  it("verifies the BNI 60,000,000 Ar principal over 32 monthly installments at 0% illustrative rate", () => {
    const schedule = buildLoanSchedule({
      principal: 60_000_000,
      annualRatePercent: 0,
      periods: 32,
      paymentsPerYear: 12,
      firstDueDate: "2027-01-15",
      method: "equal_principal",
    });
    expect(schedule.installments).toHaveLength(32);
    expect(schedule.installments.reduce((sum, row) => sum + row.principal, 0)).toBe(60_000_000);
    expect(schedule.totalInterest).toBe(0);
    expect(schedule.totalPayments).toBe(60_000_000);
    expect(schedule.installments[0].principal).toBe(1_875_000);
    expect(schedule.installments[31].closingPrincipal).toBe(0);
  });

  it("calculates periodic interest on the outstanding balance", () => {
    const schedule = buildLoanSchedule({
      principal: 1_000_000, annualRatePercent: 12, periods: 12, paymentsPerYear: 12,
      firstDueDate: "2027-02-15", method: "annuity",
    });
    expect(schedule.installments[0].interest).toBe(10_000);
    expect(schedule.installments[1].interest).toBeLessThan(schedule.installments[0].interest);
    expect(schedule.installments[schedule.installments.length - 1]?.closingPrincipal).toBe(0);
  });

  it("calculates each period's interest on the original principal when requested", () => {
    const schedule = buildL¶»§q«^