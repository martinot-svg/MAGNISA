import { describe, expect, it } from "vitest";
import { addMonthsClamped, buildLoanSchedule } from "./loan-finance";

describe("buildLoanSchedule", () => {
  it("vérifie le prêt BNI de 60 000 000 Ar sur 32 échéances mensuelles à 0 %", () => {
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

  it("calcule les intérêts périodiques sur le capital restant dû", () => {
    const schedule = buildLoanSchedule({
      principal: 1_000_000, annualRatePercent: 12, periods: 12, paymentsPerYear: 12,
      firstDueDate: "2027-02-15", method: "annuity",
    });
    expect(schedule.installments[0].interest).toBe(10_000);
    expect(schedule.installments[1].interest).toBeLessThan(schedule.installments[0].interest);
    expect(schedule.installments.at(-1)?.closingPrincipal).toBe(0);
  });

  it("calcule chaque intérêt sur le capital initial lorsque demandé", () => {
    const schedule = buildLoanSchedule({
      principal: 1_000_000, annualRatePercent: 12, periods: 12, paymentsPerYear: 12,
      firstDueDate: "2027-02-15", method: "equal_principal",
      interestCalculationMethod: "original_principal",
    });
    expect(schedule.installments.every((row) => row.interest === 10_000)).toBe(true);
    expect(schedule.totalInterest).toBe(120_000);
    expect(schedule.interestCalculationMethod).toBe("original_principal");
  });

  it("rembourse le capital en une fois avec la méthode in fine", () => {
    const schedule = buildLoanSchedule({
      principal: 100_000, annualRatePercent: 12, periods: 12, paymentsPerYear: 12,
      firstDueDate: "2027-01-01", method: "bullet",
    });
    expect(schedule.installments.slice(0, 11).every((row) => row.principal === 0)).toBe(true);
    expect(schedule.installments[11].principal).toBe(100_000);
    expect(schedule.totalInterest).toBe(12_000);
    expect(schedule.installments[11].closingPrincipal).toBe(0);
  });

  it("convertit un taux annuel effectif en taux mensuel composé", () => {
    const schedule = buildLoanSchedule({
      principal: 100_000, annualRatePercent: 12, periods: 12, paymentsPerYear: 12,
      firstDueDate: "2027-01-01", method: "equal_principal", interestType: "compound",
    });
    expect(schedule.periodicRate).toBeCloseTo(Math.pow(1.12, 1 / 12) - 1, 12);
    expect(schedule.interestType).toBe("compound");
  });

  it("borne les dates en fin de mois sans déborder sur le mois suivant", () => {
    expect(addMonthsClamped("2027-01-31", 1)).toBe("2027-02-28");
    expect(addMonthsClamped("2027-01-31", 2)).toBe("2027-03-31");
    expect(addMonthsClamped("2028-01-31", 1)).toBe("2028-02-29");
  });

  it("conserve les intérêts calculés sur le capital initial après remboursement anticipé", () => {
    const schedule = buildLoanSchedule({
      principal: 850_000, annualRatePercent: 12, periods: 10, paymentsPerYear: 12,
      firstDueDate: "2027-04-15", method: "annuity",
      interestCalculationMethod: "original_principal",
    });
    expect(schedule.installments.every((row) => row.interest === 8_500)).toBe(true);
    expect(schedule.installments[0].principal).toBe(85_000);
    expect(schedule.installments.at(-1)?.closingPrincipal).toBe(0);
  });

  it("solde intégralement un prêt à taux nul", () => {
    const schedule = buildLoanSchedule({
      principal: 100, annualRatePercent: 0, periods: 3, paymentsPerYear: 12,
      firstDueDate: "2027-02-01", method: "annuity",
    });
    expect(schedule.totalInterest).toBe(0);
    expect(schedule.totalPayments).toBe(100);
    expect(schedule.installments.at(-1)?.closingPrincipal).toBe(0);
  });

  it("rejette les paramètres financiers invalides", () => {
    const base = {
      principal: 1_000_000, annualRatePercent: 12, periods: 12, paymentsPerYear: 12,
      firstDueDate: "2027-01-15", method: "annuity" as const,
    };
    expect(() => buildLoanSchedule({ ...base, principal: 0 })).toThrow("capital");
    expect(() => buildLoanSchedule({ ...base, annualRatePercent: -1 })).toThrow("taux");
    expect(() => buildLoanSchedule({ ...base, periods: 0 })).toThrow("durée");
    expect(() => buildLoanSchedule({ ...base, paymentsPerYear: 5 })).toThrow("Périodicité");
    expect(() => buildLoanSchedule({ ...base, firstDueDate: "2027-02-30" })).toThrow("date");
  });
});
