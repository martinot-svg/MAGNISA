import { describe, expect, it } from "vitest";
import { MADAGASCAR_IRSA_2026 } from "./irsa";
import { calculatePayrollAmounts, type PayrollCalculationRule } from "./calculate-payroll";

const rule: PayrollCalculationRule = {
  cnaps_employee_rate: 0.01,
  cnaps_employer_rate: 0.13,
  health_employee_rate: 0.01,
  health_employer_rate: 0.05,
  fmfp_employer_rate: 0.01,
  cnaps_monthly_ceiling: 2_400_000,
  health_monthly_ceiling: 1_600_000,
  irsa_health_deduction_rate: 0.02,
  irsa_brackets: MADAGASCAR_IRSA_2026.brackets,
  irsa_minimum: 3_000,
  irsa_dependant_reduction: 2_000,
  irsa_dependant_threshold: 350_000,
  irsa_pension_deduction_rate: 0.10,
  irsa_rounding_unit: 100,
};

describe("Calcul centralisé des bulletins", () => {
  it("calcule une paie à partir d'un référentiel versionné", () => {
    const result = calculatePayrollAmounts({ gross: 1_000_000, dependants: 0, irsaDeductionAuthorized: true, rule });
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

  it("plafonne à 2 % du brut la déduction IRSA de la cotisation santé", () => {
    const result = calculatePayrollAmounts({
      gross: 1_000_000,
      dependants: 0,
      irsaDeductionAuthorized: true,
      rule: { ...rule, health_employee_rate: 0.03 },
    });
    expect(result.employeeSocial).toBe(10_000);
    expect(result.employeeHealth).toBe(30_000);
    // La retenue réelle reste de 3 %, mais la déduction fiscale est plafonnée à 2 %.
    expect(result.taxableBase).toBe(970_000);
    expect(result.incomeTax).toBe(101_500);
    expect(result.netBeforeOtherDeductions).toBe(858_500);
  });

  it.each([0.03, 0.005])("utilise le plafond santé IRSA versionné à %s", (rate) => {
    const result = calculatePayrollAmounts({ gross: 1_000_000, dependants: 0, rule: { ...rule, health_employee_rate: 0.03, irsa_health_deduction_rate: rate }, irsaDeductionAuthorized: true });
    const deductible = Math.min(30_000, Math.round(1_000_000 * rate * 100) / 100);
    expect(result.taxableBase).toBe(Math.floor((1_000_000 - 10_000 - deductible) / 100) * 100);
  });

  it("déduit la cotisation retraite salariale de l'assiette IRSA dans la limite de 10 % du brut", () => {
    const result = calculatePayrollAmounts({ gross: 1_000_000, employeePensionContribution: 150_000, dependants: 0, irsaDeductionAuthorized: true, rule });
    expect(result.deductibleEmployeePension).toBe(100_000);
    expect(result.employeePensionContribution).toBe(150_000);
    expect(result.taxableBase).toBe(890_000);
    expect(result.incomeTax).toBe(85_500);
    expect(result.netBeforeOtherDeductions).toBe(744_500);
  });

  it("exclut de l'assiette IRSA une rémunération explicitement qualifiée d'exonérée", () => {
    const result = calculatePayrollAmounts({ gross: 1_000_000, irsaExemptEarnings: 100_000, dependants: 0, irsaDeductionAuthorized: true, rule });
    expect(result.irsaExemptEarnings).toBe(100_000);
    expect(result.taxableBase).toBe(880_000);
    expect(result.incomeTax).toBe(83_500);
    expect(result.netBeforeOtherDeductions).toBe(896_500);
  });

  it("intègre la retraite complémentaire patronale à l'assiette IRSA sans la payer en net", () => {
    const result = calculatePayrollAmounts({
      gross: 1_000_000,
      taxableSupplementaryPension: 100_000,
      dependants: 0,
      irsaDeductionAuthorized: true,
      rule,
    });
    expect(result.taxableSupplementaryPension).toBe(100_000);
    expect(result.taxableBase).toBe(1_080_000);
    expect(result.incomeTax).toBe(123_500);
    expect(result.netBeforeOtherDeductions).toBe(856_500);
    expect(result.employerCost).toBe(1_290_000);
  });

  it("rejette un versement patronal de retraite complémentaire invalide", () => {
    expect(() => calculatePayrollAmounts({
      gross: 500_000,
      taxableSupplementaryPension: -1,
      dependants: 0,
      rule,
    })).toThrow(/retraite complémentaire/);
  });

  it("plafonne séparément les assiettes CNaPS et SMIE selon le référentiel", () => {
    const result = calculatePayrollAmounts({ gross: 3_000_000, dependants: 0, rule });
    expect(result.cnapsBase).toBe(2_400_000);
    expect(result.healthBase).toBe(1_600_000);
    expect(result.employeeSocial).toBe(24_000);
    expect(result.employeeHealth).toBe(16_000);
    expect(result.employerFmfp).toBe(24_000);
  });

  it.each([350_000, 350_100, 400_000, 400_100, 500_000, 500_100, 600_000, 600_100, 4_000_000, 4_000_100])(
    "calcule sans exception aux seuils IRSA (%i Ar)",
    (gross) => {
      const result = calculatePayrollAmounts({ gross, dependants: 0, rule });
      expect(Number.isFinite(result.incomeTax)).toBe(true);
      expect(result.incomeTax).toBeGreaterThanOrEqual(3_000);
    },
  );

  it("retourne zéro d'impôt pour un brut nul", () => {
    const result = calculatePayrollAmounts({ gross: 0, dependants: 0, rule });
    expect(result.taxableBase).toBe(0);
    expect(result.incomeTax).toBe(0);
    expect(result.netBeforeOtherDeductions).toBe(0);
  });

  it("rejette les taux et plafonds incohérents", () => {
    expect(() => calculatePayrollAmounts({
      gross: 500_000,
      dependants: 0,
      rule: { ...rule, health_employee_rate: 1.2 },
    })).toThrow(/Taux/);
    expect(() => calculatePayrollAmounts({ gross: 500_000, dependants: 0, rule: { ...rule, irsa_health_deduction_rate: 1.2 } })).toThrow(/Taux/);
    expect(() => calculatePayrollAmounts({
      gross: 500_000,
      dependants: 0,
      rule: { ...rule, cnaps_monthly_ceiling: 0 },
    })).toThrow(/plafond CNaPS/);
  });

  it("rejette une cotisation retraite ou une exonération supérieure au brut", () => {
    expect(() => calculatePayrollAmounts({ gross: 100_000, employeePensionContribution: 100_001, dependants: 0, rule })).toThrow(/retraite salariale/);
    expect(() => calculatePayrollAmounts({ gross: 100_000, irsaExemptEarnings: 100_001, dependants: 0, rule })).toThrow(/exonérée IRSA/);
  });

  it("n’applique aucune déduction fiscale sans notification écrite", () => {
    const result = calculatePayrollAmounts({ gross: 1_000_000, dependants: 0, rule });
    expect(result.irsaDeductionAuthorized).toBe(false);
    expect(result.deductibleEmployeePension).toBe(0);
    expect(result.taxableBase).toBe(1_000_000);
  });

  it("rejette un nombre de personnes à charge non entier", () => {
    expect(() => calculatePayrollAmounts({ gross: 500_000, dependants: 1.5, rule })).toThrow();
  });
});
