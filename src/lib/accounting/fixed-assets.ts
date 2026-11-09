export type StraightLineDepreciationInput = {
  acquisitionCost: number;
  directlyAttributableCost?: number;
  residualValue?: number;
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
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) throw new Error(`Date invalide : ${field}.`);
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

function cumulativeAt(base: number, service: Date, endExclusive: Date, usefulLifeMonths: number): number {
  if (endExclusive <= service) return 0;
  let elapsedMonths = 0;
  for (let month = 0; month < usefulLifeMonths; month += 1) {
    const monthStart = addMonthsClamped(service, month);
    const monthEnd = addMonthsClamped(service, month + 1);
    if (endExclusive >= monthEnd) {
      elapsedMonths += 1;
      continue;
    }
    if (endExclusive > monthStart) {
      const segmentDays = (monthEnd.getTime() - monthStart.getTime()) / DAY_MS;
      const elapsedDays = (endExclusive.getTime() - monthStart.getTime()) / DAY_MS;
      elapsedMonths += elapsedDays / segmentDays;
    }
    break;
  }
  return cents(base * Math.min(usefulLifeMonths, elapsedMonths) / usefulLifeMonths);
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
  const openingAccumulated = cumulativeAt(base, service, periodStart, input.usefulLifeMonths);
  const closingAccumulated = cumulativeAt(base, service, periodEndExclusive, input.usefulLifeMonths);
  const charge = cents(Math.max(0, closingAccumulated - openingAccumulated));
  const closingNet = cents(Math.max(residual, gross - closingAccumulated));
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
