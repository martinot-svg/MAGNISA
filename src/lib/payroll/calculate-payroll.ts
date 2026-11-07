import { calculateIrsa, type IrsaBracket } from "@/lib/payroll/irsa";
import { computeHealthContribution } from "@/lib/payroll/health-contribution";

export type PayrollCalculationRule = {
  cnaps_employee_rate: number;
  cnaps_employer_rate: number;
  health_employee_rate: number;
  health_employer_rate: number;
  fmfp_employer_rate: number;
  cnaps_monthly_ceiling: number;
  health_monthly_ceiling: number;
  irsa_health_deduction_rate: number;
  irsa_brackets: readonly IrsaBracket[];
  irsa_minimum: number;
  irsa_dependant_reduction: number;
  irsa_dependant_threshold: number;
  irsa_pension_deduction_rate: number;
  irsa_rounding_unit: number;
};

export type PayrollCalculation = {
  gross: number;
  cnapsBase: number;
  healthBase: number;
  employeeSocial: number;
  employeeHealth: number;
  employerSocial: number;
  employerHealth: number;
  employerFmfp: number;
  taxableBase: number;
  incomeTax: number;
  taxableSupplementaryPension: number;
  employeePensionContribution: number;
  deductibleEmployeePension: number;
  irsaExemptEarnings: number;
  netBeforeOtherDeductions: number;
  employerCost: number;
};

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function assertRate(name: string, value: number) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`Taux de paie invalide : ${name}.`);
  }
}

export function calculatePayrollAmounts(input: {
  gross: number;
  dependants: number;
  rule: PayrollCalculationRule;
  taxableSupplementaryPension?: number;
  employeePensionContribution?: number;
  irsaExemptEarnings?: number;
  irsaDeductionAuthorized?: boolean;
}): PayrollCalculation {
  const { gross, dependants, rule } = input;
  const taxableSupplementaryPension = input.taxableSupplementaryPension ?? 0;
  const employeePensionContribution = input.employeePensionContribution ?? 0;
  const irsaExemptEarnings = input.irsaExemptEarnings ?? 0;
  const irsaDeductionAuthorized = input.irsaDeductionAuthorized ?? false;
  if (!Number.isFinite(taxableSupplementaryPension) || taxableSupplementaryPension < 0) {
    throw new Error("Versement patronal de retraite complémentaire invalide.");
  }
  if (!Number.isFinite(employeePensionContribution) || employeePensionContribution < 0 || employeePensionContribution > gross) {
    throw new Error("Cotisation retraite salariale invalide.");
  }
  if (!Number.isFinite(irsaExemptEarnings) || irsaExemptEarnings < 0 || irsaExemptEarnings > gross) {
    throw new Error("Rémunération exonérée IRSA invalide : elle doit être comprise dans le brut.");
  }
  if (!Number.isFinite(gross) || gross < 0) {
    throw new Error("Salaire brut invalide.");
  }
  if (!Number.isInteger(dependants) || dependants < 0 || dependants > 30) {
    throw new Error("Nombre de personnes à charge invalide.");
  }

  assertRate("CNaPS salarié", rule.cnaps_employee_rate);
  assertRate("CNaPS employeur", rule.cnaps_employer_rate);
  assertRate("SMIE salarié", rule.health_employee_rate);
  assertRate("SMIE employeur", rule.health_employer_rate);
  assertRate("FMFP employeur", rule.fmfp_employer_rate);
  assertRate("Plafond de déduction santé IRSA", rule.irsa_health_deduction_rate);
  assertRate("Plafond de déduction retraite IRSA", rule.irsa_pension_deduction_rate);
  for (const [name, value] of [["réduction par personne à charge", rule.irsa_dependant_reduction], ["seuil de réduction personnes à charge", rule.irsa_dependant_threshold], ["unité d'arrondi IRSA", rule.irsa_rounding_unit]] as const) {
    if (!Number.isFinite(value) || value < 0 || (name === "unité d'arrondi IRSA" && value <= 0)) throw new Error(`Paramètre réglementaire IRSA invalide : ${name}.`);
  }

  for (const [name, value] of [
    ["plafond CNaPS", rule.cnaps_monthly_ceiling],
    ["plafond SMIE", rule.health_monthly_ceiling],
  ] as const) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`Paramètre réglementaire invalide : ${name}.`);
    }
  }

  const cnapsBase = Math.min(gross, rule.cnaps_monthly_ceiling);
  const health = computeHealthContribution(
    gross,
    rule.health_monthly_ceiling,
    rule.health_employee_rate,
    rule.health_employer_rate,
  );
  const employeeSocial = roundMoney(cnapsBase * rule.cnaps_employee_rate);

  // Le plafond de déduction santé IRSA est versionné dans le référentiel applicable à la période.
  // La retenue santé réelle reste intégralement due, même si elle dépasse ce plafond.
  const deductibleHealth = Math.min(health.employee, roundMoney(gross * rule.irsa_health_deduction_rate));

  const deductibleEmployeePension = Math.min(employeePensionContribution, roundMoney(gross * rule.irsa_pension_deduction_rate));
  const irsa = calculateIrsa({
    taxableIncome: Math.max(0, gross - irsaExemptEarnings + taxableSupplementaryPension - deductibleHealth - deductibleEmployeePension),
    dependants,
    brackets: rule.irsa_brackets,
    minimum: rule.irsa_minimum,
    dependantReduction: rule.irsa_dependant_reduction,
    dependantThreshold: rule.irsa_dependant_threshold,
    roundingUnit: rule.irsa_rounding_unit,
  });
  const employerSocial = roundMoney(cnapsBase * rule.cnaps_employer_rate);
  const employerFmfp = roundMoney(cnapsBase * rule.fmfp_employer_rate);
  const netBeforeOtherDeductions = roundMoney(
    gross - employeeSocial - health.employee - employeePensionContribution - irsa.tax,
  );
  const employerCost = roundMoney(
    gross + employerSocial + health.employer + employerFmfp + taxableSupplementaryPension,
  );

  return {
    gross,
    cnapsBase,
    healthBase: health.base,
    employeeSocial,
    employeeHealth: health.employee,
    employerSocial,
    employerHealth: health.employer,
    employerFmfp,
    taxableBase: irsa.taxableBase,
    incomeTax: irsa.tax,
    taxableSupplementaryPension,
    employeePensionContribution,
    deductibleEmployeePension,
    irsaExemptEarnings,
    irsaDeductionAuthorized,
    netBeforeOtherDeductions,
    employerCost,
  };
}
