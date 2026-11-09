export type StraightLineDepreciationInput = {
  acquisitionCost: number;
  directlyAttributableCost?: number;
  residualValue?: number;
  openingAccumulatedDepreciation?: number;
  openingImpairmentLoss?: number;
  openingNetBookValue?: number;
  usefulLifeMonths: number;
  inServiceDate: string;
  periodStart: string;
  periodEnd: string;
};

export type StraightLineDepreciationResult = {
  depreciableBase: number;
  usefulLifeEndDate: string;
  totalUsefulLifeMonths: number;
  daysDepreciatedInPeriod: number;
  openingAccumulatedDepreciation: number;
  depreciationCharge: number;
  closingAccumulatedDepreciation: number;
  closingNetBookValue: number;
};

const cents = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const DAY_MS = 86_400_000;

function parseDate(value: string, field: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Date invalide : ${field}.`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`Date invalide : ${field}.`);
  }
  return date;
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addMonthsClamped(anchor: Date, months: number): Date {
  const targetFirst = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(targetFirst.getUTCFullYear(), targetFirst.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(targetFirst.getUTCFullYear(), targetFirst.getUTCMonth(), Math.min(anchor.getUTCDate(), lastDay)));
}

function elapsedMonthUnits(service: Date, start: Date, endExclusive: Date, usefulLifeMonths: number): number {
  if (endExclusive <= start) return 0;
  let elapsedMonths = 0;
  for (let month = 0; month < usefulLifeMonths; month += 1) {
    const monthStart = addMonthsClamped(service, month);
    const monthEnd = addMonthsClamped(service, month + 1);
    const overlapStart = new Date(Math.max(start.getTime(), monthStart.getTime()));
    const overlapEnd = new Date(Math.min(endExclusive.getTime(), monthEnd.getTime()));
    if (overlapEnd > overlapStart) {
      const segmentDays = (monthEnd.getTime() - monthStart.getTime()) / DAY_MS;
      const elapsedDays = (overlapEnd.getTime() - overlapStart.getTime()) / DAY_MS;
      elapsedMonths += elapsedDays / segmentDays;
    }
    if (monthEnd >= endExclusive) break;
  }
  return Math.min(usefulLifeMonths, elapsedMonths);
}

/**
 * Computes a monthly straight-line schedule with day-prorata for incomplete months.
 * The service start date is included; the useful-life end date is exclusive.
 * This is a calculation engine only: it does not post a journal entry.
 * Confirm the entity's statutory PCG policy and prorata convention before posting.
 */
export function calculateStraightLineDepreciation(
  input: StraightLineDepreciationInput,
): StraightLineDepreciationResult {
  const cost = input.acquisitionCost;
  const directCosts = input.directlyAttributableCost ?? 0;
  const residual = input.residualValue ?? 0;
  if (![cost, directCosts, residual].every(Number.isFinite) || cost < 0 || directCosts < 0 || residual < 0) {
    throw new Error("Les coûts et la valeur résiduelle doivent être des montants positifs ou nuls.");
  }
  if (!Number.isInteger(input.usefulLifeMonths) || input.usefulLifeMonths <= 0) {
    throw new Error("La durée d'utilisation doit être un nombre entier de mois strictement positif.");
  }
  const service = parseDate(input.inServiceDate, "mise en service");
  const periodStart = parseDate(input.periodStart, "début de période");
  const periodEnd = parseDate(input.periodEnd, "fin de période");
  if (periodEnd < periodStart) throw new Error("La fin de période doit être postérieure ou égale au début.");

  const gross = cents(cost + directCosts);
  if (residual > gross) throw new Error("La valeur résiduelle ne peut pas dépasser le coût amortissable brut.");
  const base = cents(gross - residual);
  const usefulLifeEnd = addMonthsClamped(service, input.usefulLifeMonths);
  if (usefulLifeEnd <= service) throw new Error("La durée d'utilisation calculée est invalide.");

  const periodEndExclusive = new Date(Math.min(periodEnd.getTime() + DAY_MS, usefulLifeEnd.getTime()));
  const openingAccumulated = input.openingAccumulatedDepreciation === undefined
    ? cents(base * elapsedMonthUnits(service, service, periodStart, input.usefulLifeMonths) / input.usefulLifeMonths)
    : cents(input.openingAccumulatedDepreciation);
  const openingImpairment = input.openingImpairmentLoss ?? 0;
  if (!Number.isFinite(openingImpairment) || openingImpairment < 0 || openingAccumulated < 0 ||
      openingAccumulated + openingImpairment > gross) {
    throw new Error("Les amortissements et dépréciations d'ouverture sont invalides.");
  }
  const openingNet = input.openingNetBookValue === undefined
    ? cents(gross - openingAccumulated - openingImpairment)
    : cents(input.openingNetBookValue);
  if (openingNet < residual || openingNet > gross - openingAccumulated) {
    throw new Error("La valeur nette comptable d'ouverture est incohérente.");
  }
  const elapsedBefore = elapsedMonthUnits(service, service, periodStart, input.usefulLifeMonths);
  const remainingUnits = Math.max(0, input.usefulLifeMonths - elapsedBefore);
  const periodUnits = elapsedMonthUnits(service, new Date(Math.max(periodStart.getTime(), service.getTime())), periodEndExclusive, input.usefulLifeMonths);
  const remainingDepreciableAmount = Math.max(0, openingNet - residual);
  const charge = cents(remainingUnits > 0
    ? Math.min(remainingDepreciableAmount, remainingDepreciableAmount * periodUnits / remainingUnits)
    : 0);
  const closingAccumulated = cents(openingAccumulated + charge);
  const closingNet = cents(Math.max(residual, openingNet - charge));
  const activeStart = new Date(Math.max(periodStart.getTime(), service.getTime()));
  const daysDepreciated = Math.max(0, Math.floor((periodEndExclusive.getTime() - activeStart.getTime()) / DAY_MS));

  return {
    depreciableBase: base,
    usefulLifeEndDate: iso(usefulLifeEnd),
    totalUsefulLifeMonths: input.usefulLifeMonths,
    daysDepreciatedInPeriod: daysDepreciated,
    openingAccumulatedDepreciation: openingAccumulated,
    depreciationCharge: charge,
    closingAccumulatedDepreciation: closingAccumulated,
    closingNetBookValue: closingNet,
  };
}
