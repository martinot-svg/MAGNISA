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
  irsa_pension_deduction_rate: number;
  irsa_brackets: readonly IrsaBracket[];
  irsa_minimum: number;
  irsa_dependant_reduction: number;
  irsa_dependant_threshold: number;
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
  taxableCompensation: number;
  deductibleHealth: number;
  deductiblePension: number;
  incomeTax: number;
  taxableSupplementaryPension: number;
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
  taxableCompensation?: number;
  dependants: number;
  rule: PayrollCalculationRule;
  taxableSupplementaryPension?: number;
  additionalEmployeePensionContribution?: number;
  deductionsAuthorized?: boolean;
}): PayrollCalculation {
  const { gross, dependants, rule } = input;
  const taxableCompensation = input.taxableCompensation ?? gross;
  if (!Number.isFinite(taxableCompensation) || taxableCompensation < 0 || taxableCompensation > gross) {
    throw new Error("Assiette de rémunération imposable invalide.");
  }
  const taxableSupplementaryPension = input.taxableSupplementaryPension ?? 0;
  const additionalEmployeePensionContribution = input.additionalEmployeePensionContribution ?? 0;
  const deductionsAuthorized = input.deductionsAuthorized === true;
  if (!Number.isFinite(taxableSupplementaryPension) || taxableSupplementaryPension < 0) {
    throw new Error("Versement patronal de retraite complémentaire invalide.");
  }
  if (!Number.isFinite(additionalEmployeePensionContribution) || additionalEmployeePensionContribution < 0) {
    throw new Error("Cotisation salariale de retraite complémentaire invalide.");
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
  if (rule.irsa_health_deduction_rate > 0.02) throw new Error("Le plafond légal de déduction santé IRSA ne peut pas dépasser 2 %.");
  if (rule.irsa_pension_deduction_rate > 0.10) throw new Error("Le plafond légal de déduction retraite IRSA ne peut pas dépasser 10 %.");

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
  // Articles 01.03.09 and 01.03.11: these deductions apply only when the
  // employer has the employee's written notification covering the full pay period.
  const deductibleHealth = deductionsAuthorized
    ? Math.min(health.employee, roundMoney(gross * rule.irsa_health_deduction_rate))
    : 0;
  const deductiblePension = deductionsAuthorized
    ? Math.min(employeeSocial + additionalEmployeePensionContribution, roundMoney(gross * rule.irsa_pension_deduction_rate))
    : 0;

  const irsa = calculateIrsa({
    taxableIncome: Math.max(0, taxableCompensation + taxableSupplementaryPension - deductiblePension - deductibleHealth),
    dependants,
    brackets: rule.irsa_brackets,
    minimum: rule.irsa_minimum,
    dependantReduction: rule.irsa_dependant_reduction,
    dependantThreshold: rule.irsa_dependant_threshold,
  });
  const employerSocial = roundMoney(cnapsBase * rule.cnaps_employer_rate);
  const employerFmfp = roundMoney(cnapsBase * rule.fmfp_employer_rate);
  const netBeforeOtherDeductions = roundMoney(
    gross - employeeSocial - health.employee - additionalEmployeePensionContribution - irsa.tax,
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
    taxableCompensation,
    deductibleHealth,
    deductiblePension,
    incomeTax: irsa.tax,
    taxableSupplementaryPension,
    netBeforeOtherDeductions,
    employerCost,
  };
}
