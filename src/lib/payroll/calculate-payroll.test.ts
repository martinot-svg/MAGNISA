import { describe, expect, it } from "vitest";
import { MADAGASCAR_IRSA_2026 } from "./irsa";
import { calculatePayrollAmounts, type PayrollCalculationRule } from "./calculate-payroll";

const rule: PayrollCalculationRule = {
  cnaps_employee_rate: 0.01,
  cnaps_employer_rate: 0.13,
  health_employee_rate: 0.01,
  health_employer_rate: 0.05,
  fmfp_employer_rate: 0.01,
  cnaps_monthly_ceiling: 2_520_000,
  health_monthly_ceiling: 2_520_000,
  irsa_brackets: MADAGASCAR_IRSA_2026.brackets,
  irsa_minimum: 3_000,
};

describe("Calcul centralisé des bulletins", () => {
  it("calcule une paie à partir d'un référentiel versionné", () => {
    const result = calculatePayrollAmounts({ gross: 1_000_000, dependants: 0, rule });
    expect(result.cnapsBase).toBe(1_000_000);
    expect(result.healthBase).toBe(1_000_000);
    expect(result.employeeSocial).toBe(10_000);
    expect(result.employeeHealth).toBe(10_000);
    expect(result.employerSocial).toBe(130_000);
    expect(result.employerHealth).toBe(50_000);
    expect(result.employerFmfp).toBe(10_000);
    expect(result.taxableBase).toBe(980_000);
    expect(result.incomeTax).toBe(103_500);
    expect(result.netBeforeOtherDeductions).toBe(876_500);
    expect(result.employerCost).toBe(1_190_000);
  });

  it("plafonne séparément les assiettes CNaPS et SMIE", () => {
    const result = calculatePayrollAmounts({ gross: 3_000_000, dependants: 0, rule });
    expect(result.cnapsBase).toBe(2_520_000);
    expect(result.healthBase).toBe(2_520_000);
    expect(result.employeeSocial).toBe(25_200);
    expect(result.employeeHealth).toBe(25_200);
    expect(result.employerFmfp).toBe(25_200);
  });

  it.each([350_000, 350_100, 400_000, 400_100, 500_000, 500_100, 600_000, 600_100, 4_000_000, 4_000_100])(
    "calcule sans exception aux seuils IRSA (%i Ar)",
    (gross) => {
      const result = calculatePayrollAmounts({ gross, dependants: 0, rule });
      expect(Number.isFinite(result.incomeTax)).toBe(true);
      expect(result.incomeTax).toBeGreaterThanOrEqual(3_000);
    },
  );

  it("rejette les taux et plafonds incohérents", () => {
    expect(() => calculatePayrollAmounts({
      gross: 500_000,
      dependants: 0,
      rule: { ...rule, health_employee_rate: 1.2 },
    })).toThrow(/Taux/);
    expect(() => calculatePayrollAmounts({
      gross: 500_000,
      dependants: 0,
      rule: { ...rule, cnaps_monthly_ceiling: 0 },
    })).toThrow(/plafond CNaPS/);
  });

  it("rejette un nombre de personnes à charge non entier", () => {
    expect(() => calculatePayrollAmounts({ gross: 500_000, dependants: 1.5, rule })).toThrow();
  });
});
