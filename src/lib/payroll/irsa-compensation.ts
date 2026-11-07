export type CompensationTaxTreatment =
  | "fully_taxable"
  | "fully_exempt"
  | "partially_taxable"
  | "exemption_capped"
  | "conditional"
  | "special";

export type IrsaCompensationRule = {
  code: string;
  treatment: CompensationTaxTreatment;
  taxableRate?: number;
  exemptionCap?: number;
  conditionKey?: string;
  legalReference: string;
  ruleVersion: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
};

export type IrsaCompensationItem = {
  code: string;
  amount: number;
  conditions?: Record<string, boolean>;
  specialTaxableAmount?: number;
};

export type IrsaCompensationResult = {
  grossCompensation: number;
  taxableCompensation: number;
  exemptCompensation: number;
  details: Array<{
    code: string;
    amount: number;
    taxableAmount: number;
    exemptAmount: number;
    treatment: CompensationTaxTreatment;
    legalReference: string;
    ruleVersion: string;
  }>;
};

/**
 * Applies only a dated, sourced classification. Missing classifications fail closed:
 * an unclassified compensation item is never silently excluded from the IRSA base.
 */
export function classifyIrsaCompensation(
  items: readonly IrsaCompensationItem[],
  rules: readonly IrsaCompensationRule[],
  periodDate: string,
): IrsaCompensationResult {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodDate)) {
    throw new Error("Date de période IRSA invalide.");
  }

  const details = items.map((item) => {
    if (!item.code.trim() || !Number.isFinite(item.amount) || item.amount < 0) {
      throw new Error("Élément de rémunération IRSA invalide.");
    }
    const matches = rules.filter((rule) =>
      rule.code === item.code &&
      rule.effectiveFrom <= periodDate &&
      (!rule.effectiveTo || rule.effectiveTo >= periodDate),
    );
    if (matches.length !== 1) {
      throw new Error(`Classification fiscale absente ou ambiguë pour ${item.code}.`);
    }
    const rule = matches[0];
    if (!rule.legalReference.trim() || !rule.ruleVersion.trim()) {
      throw new Error(`Référence réglementaire ou version absente pour ${item.code}.`);
    }

    let taxableAmount = item.amount;
    switch (rule.treatment) {
      case "fully_taxable":
        break;
      case "fully_exempt":
        taxableAmount = 0;
        break;
      case "partially_taxable":
        if (rule.taxableRate === undefined || !Number.isFinite(rule.taxableRate) ||
            rule.taxableRate < 0 || rule.taxableRate > 1) {
          throw new Error(`Taux imposable invalide pour ${item.code}.`);
        }
        taxableAmount = item.amount * rule.taxableRate;
        break;
      case "exemption_capped":
        if (rule.exemptionCap === undefined || !Number.isFinite(rule.exemptionCap) ||
            rule.exemptionCap < 0) {
          throw new Error(`Plafond d'exonération invalide pour ${item.code}.`);
        }
        taxableAmount = Math.max(0, item.amount - rule.exemptionCap);
        break;
      case "conditional":
        if (!rule.conditionKey) {
          throw new Error(`Condition réglementaire absente pour ${item.code}.`);
        }
        taxableAmount = item.conditions?.[rule.conditionKey] === true ? 0 : item.amount;
        break;
      case "special":
        if (item.specialTaxableAmount === undefined ||
            !Number.isFinite(item.specialTaxableAmount) ||
            item.specialTaxableAmount < 0 || item.specialTaxableAmount > item.amount) {
          throw new Error(`Montant imposable spécial invalide pour ${item.code}.`);
        }
        taxableAmount = item.specialTaxableAmount;
        break;
    }

    taxableAmount = Math.round((taxableAmount + Number.EPSILON) * 100) / 100;
    return {
      code: item.code,
      amount: item.amount,
      taxableAmount,
      exemptAmount: Math.round((item.amount - taxableAmount + Number.EPSILON) * 100) / 100,
      treatment: rule.treatment,
      legalReference: rule.legalReference,
      ruleVersion: rule.ruleVersion,
    };
  });

  const grossCompensation = details.reduce((sum, item) => sum + item.amount, 0);
  const taxableCompensation = details.reduce((sum, item) => sum + item.taxableAmount, 0);
  return {
    grossCompensation: Math.round((grossCompensation + Number.EPSILON) * 100) / 100,
    taxableCompensation: Math.round((taxableCompensation + Number.EPSILON) * 100) / 100,
    exemptCompensation: Math.round((grossCompensation - taxableCompensation + Number.EPSILON) * 100) / 100,
    details,
  };
}

export type OvertimeTaxInput = {
  totalHours: number;
  hourlyRate: number;
  premiumRate: number;
  overtimePay: number;
  additionalPremiums?: number;
  isCadre: boolean;
  timeRecordReconciled: boolean;
  monthlyExemptHoursLimit?: number;
};

export type OvertimeTaxResult = {
  exemptHours: number;
  taxableHours: number;
  exemptAmount: number;
  taxableAmount: number;
  exemptionApplied: boolean;
};

/**
 * DGI Decision n°02-MEF/SG/DGI/DLFC (11 Oct 2019):
 * first 20 monthly overtime hours only; excludes cadres; exempt amount includes
 * the ordinary hourly wage plus overtime premium, but excludes other premiums.
 * No exemption is applied without a reconciled monthly time record.
 */
export function calculateOvertimeIrsa(input: OvertimeTaxInput): OvertimeTaxResult {
  const {
    totalHours, hourlyRate, premiumRate, overtimePay, additionalPremiums = 0,
    isCadre, timeRecordReconciled, monthlyExemptHoursLimit = 20,
  } = input;
  for (const [name, value] of Object.entries({
    totalHours, hourlyRate, premiumRate, overtimePay, additionalPremiums, monthlyExemptHoursLimit,
  })) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`Paramètre heures supplémentaires invalide : ${name}.`);
  }
  if (premiumRate > 10 || monthlyExemptHoursLimit > 20 || totalHours > 1000) {
    throw new Error("Paramètre heures supplémentaires hors limites.");
  }
  if (additionalPremiums > overtimePay) {
    throw new Error("Les primes additionnelles dépassent la rémunération des heures supplémentaires.");
  }

  const exemptHours = !isCadre && timeRecordReconciled
    ? Math.min(totalHours, monthlyExemptHoursLimit)
    : 0;
  const eligibleHourlyCompensation = hourlyRate * (1 + premiumRate);
  const exemptAmount = Math.min(
    Math.max(0, overtimePay - additionalPremiums),
    eligibleHourlyCompensation * exemptHours,
  );
  const roundedExempt = Math.round((exemptAmount + Number.EPSILON) * 100) / 100;
  return {
    exemptHours,
    taxableHours: totalHours - exemptHours,
    exemptAmount: roundedExempt,
    taxableAmount: Math.round((overtimePay - roundedExempt + Number.EPSILON) * 100) / 100,
    exemptionApplied: roundedExempt > 0,
  };
}
