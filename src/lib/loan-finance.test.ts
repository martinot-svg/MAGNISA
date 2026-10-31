import { describe, expect, it } from "vitest";
import { addMonthsClamped, buildLoanSchedule } from "./loan-finance";

describe("buildLoanSchedule", () => {
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
    const schedule = buildLoanSchedule({
      principal: 1_000_000, annualRatePercent: 12, periods: 12, paymentsPerYear: 12,
      firstDueDate: "2027-02-15", method: "equal_principal",
      interestCalculationMethod: "original_principal",
    });
    expect(schedule.installments.every((row) => row.interest === 10_000)).toBe(true);
    expect(schedule.totalInterest).toBe(120_000);
    expect(schedule.lastDueDate).toBe("2028-01-15");
  });

  it("keeps principal outstanding until maturity for bullet loans", () => {
    const schedule = buildLoanSchedule({
      principal: 1_000_000, annualRatePercent: 12, periods: 4, paymentsPerYear: 4,
      firstDueDate: "2027-04-01", method: "bullet",
    });
    expect(schedule.installments.slice(0, 3).every((row) => row.principal === 0)).toBe(true);
    expect(schedule.installments[3].principal).toBe(1_000_000);
    expect(schedule.installments[3].closingPrincipal).toBe(0);
  });

  it("supports zero interest and settles the full principal", () => {
    const schedule = buildLoanSchedule({
      principal: 100, annualRatePercent: 0, periods: 3, paymentsPerYear: 12,
      firstDueDate: "2027-02-01", method: "annuity",
    });
    expect(schedule.totalInterest).toBe(0);
    expect(schedule.totalPayments).toBe(100);
    expect(schedule.installments[schedule.installments.length - 1]?.closingPrincipal).toBe(0);
  });

  it("clamps month-end due dates without drifting", () => {
    expect(addMonthsClamped("2027-01-31", 1)).toBe("2027-02-28");
    expect(addMonthsClamped("2027-01-31", 2)).toBe("2027-03-31");
  });
});
