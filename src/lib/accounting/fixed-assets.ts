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
  totalUsefulLifeDays: number;
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

function addMonthsClamped(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const targetFirst = new Date(Date.UTC(year, month + months, 1));
  const lastDay = new Date(Date.UTC(targetFirst.getUTCFullYear(), targetFirst.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(targetFirst.getUTCFullYear(), targetFirst.getUTCMonth(), Math.min(day, lastDay)));
}

function cumulativeAt(base: number, start: Date, endExclusive: Date, totalDays: number): number {
  const elapsed = Math.max(0, Math.min(totalDays, Math.floor((endExclusive.getTime() - start.getTime()) / DAY_MS)));
  if (elapsed >= totalDays) return cents(base);
  return cents(base * elapsed / totalDays);
}

/**
 * Computes a calendar-day straight-line schedule for review.
 * The service start date is included; the useful-life end date is exclusive.
 * This is a calculation engine only: it does not post a journal entry.
 * Confirm the entity's PCG policy (including prorata convention) before statutory posting.
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
  if (periodEnd < service) throw new Error("La période se termine avant la mise en service.");

  const gross = cents(cost + directCosts);
  if (residual > gross) throw new Error("La valeur résiduelle ne peut pas dépasser le coût amortissable brut.");
  const base = cents(gross - residual);
  const usefulLifeEnd = addMonthsClamped(service, input.usefulLifeMonths);
  const totalDays = Math.floor((usefulLifeEnd.getTime() - service.getTime()) / DAY_MS);
  if (totalDays <= 0) throw new Error("La durée d'utilisation calculée est invalide.");

  const periodEndExclusive = new Date(Math.min(periodEnd.getTime() + DAY_MS, usefulLifeEnd.getTime()));
  const openingCutoff = new Date(Math.max(periodStart.getTime(), service.getTime()));
  const openingAccumulated = openingCutoff <= service
    ? 0
    : cumulativeAt(base, service, openingCutoff, totalDays);
  const closingAccumulated = cumulativeAt(base, service, periodEndExclusive, totalDays);
  const charge = cents(Math.max(0, closingAccumulated - openingAccumulated));
  const closingNet = cents(Math.max(residual, gross - closingAccumulated));

  return {
    depreciableBase: base,
    usefulLifeEndDate: iso(usefulLifeEnd),
    totalUsefulLifeDays: totalDays,
    daysDepreciatedInPeriod: Math.max(0, Math.floor((periodEndExclusive.getTime() - Math.max(periodStart.getTime(), service.getTime())) / DAY_MS)),
    openingAccumulatedDepreciation: openingAccumulated,
    depreciationCharge: charge,
    closingAccumulatedDepreciation: closingAccumulated,
    closingNetBookValue: closingNet,
  };
}
