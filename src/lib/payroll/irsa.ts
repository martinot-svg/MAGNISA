export type IrsaBracket = { up_to: number | null; rate: number };

export const MADAGASCAR_IRSA_2026 = {
  effectiveFrom: "2026-01-01",
  preparationEffectiveFrom: "2026-11-01",
  minimum: 3000,
  dependantReduction: 2000,
  dependantThreshold: 350000,
  roundingUnit: 100,
  legalReference:
    "Loi n°2025-021 portant loi de finances pour 2026, article 01.03.16 ; Code des impôts 2026, articles 01.03.16 et 01.03.19. Texte officiel : https://cnlegis.gov.mg/uploads/L2025-021_VF.pdf",
  brackets: [
    { up_to: 350000, rate: 0 },
    { up_to: 400000, rate: 0.05 },
    { up_to: 500000, rate: 0.10 },
    { up_to: 600000, rate: 0.15 },
    { up_to: 4000000, rate: 0.20 },
    { up_to: null, rate: 0.25 },
  ] satisfies IrsaBracket[],
} as const;

export type IrsaCalculation = {
  taxableBase: number;
  progressiveTax: number;
  dependantReduction: number;
  tax: number;
};

type CalculateIrsaInput = {
  taxableIncome: number;
  dependants?: number;
  brackets?: readonly IrsaBracket[];
  minimum?: number;
  dependantReduction?: number;
  dependantThreshold?: number;
};

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function calculateIrsa({
  taxableIncome,
  dependants = 0,
  brackets = MADAGASCAR_IRSA_2026.brackets,
  minimum = MADAGASCAR_IRSA_2026.minimum,
  dependantReduction = MADAGASCAR_IRSA_2026.dependantReduction,
  dependantThreshold = MADAGASCAR_IRSA_2026.dependantThreshold,
}: CalculateIrsaInput): IrsaCalculation {
  if (!Number.isFinite(taxableIncome) || taxableIncome < 0) {
    throw new Error("Base imposable IRSA invalide.");
  }
  if (!Number.isInteger(dependants) || dependants < 0 || dependants > 30) {
    throw new Error("Nombre de personnes à charge IRSA invalide.");
  }
  if (!Number.isFinite(minimum) || minimum < 0 ||
      !Number.isFinite(dependantReduction) || dependantReduction < 0 ||
      !Number.isFinite(dependantThreshold) || dependantThreshold < 0) {
    throw new Error("Paramètre de minimum ou de réduction IRSA invalide.");
  }
  if (!Array.isArray(brackets) || brackets.length === 0 ||
      brackets[brackets.length - 1]?.up_to !== null) {
    throw new Error("Barème IRSA incomplet : la dernière tranche doit être sans plafond.");
  }

  let previous = 0;
  for (const bracket of brackets) {
    const rate = Number(bracket.rate);
    const cap = bracket.up_to === null ? Number.POSITIVE_INFINITY : Number(bracket.up_to);
    if (!Number.isFinite(rate) || rate < 0 || rate > 1 || !(cap > previous)) {
      throw new Error("Barème IRSA invalide : taux ou bornes incohérents.");
    }
    previous = cap;
  }

  const taxableBase = Math.floor(taxableIncome / MADAGASCAR_IRSA_2026.roundingUnit) *
    MADAGASCAR_IRSA_2026.roundingUnit;
  if (taxableBase === 0) {
    return { taxableBase, progressiveTax: 0, dependantReduction: 0, tax: 0 };
  }

  let progressiveTax = 0;
  previous = 0;
  for (const bracket of brackets) {
    const cap = bracket.up_to === null ? Number.POSITIVE_INFINITY : bracket.up_to;
    progressiveTax += Math.max(0, Math.min(taxableBase, cap) - previous) * bracket.rate;
    previous = cap;
    if (taxableBase <= cap) break;
  }

  progressiveTax = roundMoney(progressiveTax);
  const beforeDependants = Math.max(minimum, progressiveTax);
  const reduction = taxableBase > dependantThreshold
    ? dependantReduction * dependants
    : 0;
  const tax = Math.max(minimum, roundMoney(beforeDependants - reduction));

  return {
    taxableBase,
    progressiveTax,
    dependantReduction: beforeDependants - tax,
    tax,
  };
}
