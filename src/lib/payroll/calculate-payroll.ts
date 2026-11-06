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
  irsa_brackets: readonly IrsaBracket[];
  irsa_minimum: number;
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
}): PayrollCalculation {
  const { gross, dependants, rule } = input;
  const taxableSupplementaryPension = input.taxableSupplementaryPension ?? 0;
  if (!Number.isFinite(taxableSupplementaryPension) || taxableSupplementaryPension < 0) {
    throw new Error("Versement patronal de retraite complémentaire invalide.");
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

  // CGI Madagascar, article 01.03.09, 2° : la cotisation ouvrière
  // à un organisme sanitaire/assurance santé est déductible dans la
  // limite de 1 % du salaire brut. Une retenue SMIE contractuelle
  // supérieure reste due, mais son excédent n'abaisse pas l'assiette IRSA.
  const deductibleHealth = Math.min(health.employee, roundMoney(gross * 0.01));

  const irsa = calculateIrsa({
    taxableIncome: Math.max(0, gross + taxableSupplementaryPension - employeeSocial - deductibleHealth),
    dependants,
    brackets: rule.irsa_brackets,
    minimum: rule.irsa_minimum,
  });
  const employerSocial = roundMoney(cnapsBase * rule.cnaps_employer_rate);
  const employerFmfp = roundMoney(cnapsBase * rule.fmfp_employer_rate);
  const netBeforeOtherDeductions = roundMoney(
    gross - employeeSocial - health.employee - irsa.tax,
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
    netBeforeOtherDeductions,
    employerCost,
  };
}
