import type { BillingUnit } from "./billing-units";

export type PricingInput = {
  unit: BillingUnit;
  quantity: number;
  unitPrice: number;
  taxRate?: number;
  discountRate?: number;
};

export type PricingResult = {
  quantity: number;
  unitPrice: number;
  subtotal: number;
  discount: number;
  taxableAmount: number;
  tax: number;
  total: number;
};

function assertFiniteNonNegative(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} doit être un nombre fini positif ou nul.`);
  }
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Calcule un montant de ligne. La quantité représente le nombre d'unités
 * facturées (heures, jours, nuitées, participants, séances, etc.).
 *
 * La durée calendaire et les règles de prorata doivent être calculées en
 * amont avec un fuseau horaire explicite ; elles ne sont pas devinées ici.
 */
export function calculateServicePrice(input: PricingInput): PricingResult {
  assertFiniteNonNegative("Quantité", input.quantity);
  assertFiniteNonNegative("Prix unitaire", input.unitPrice);

  const taxRate = input.taxRate ?? 0;
  const discountRate = input.discountRate ?? 0;

  if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
    throw new Error("Le taux de taxe doit être compris entre 0 et 100.");
  }
  if (
    !Number.isFinite(discountRate) ||
    discountRate < 0 ||
    discountRate > 100
  ) {
    throw new Error("La remise doit être comprise entre 0 et 100.");
  }

  const subtotalRaw = input.quantity * input.unitPrice;
  if (!Number.isFinite(subtotalRaw)) {
    throw new Error("Le montant de la ligne dépasse la capacité de calcul.");
  }
  const subtotal = roundMoney(subtotalRaw);
  const discountRaw = subtotal * (discountRate / 100);
  if (!Number.isFinite(discountRaw)) {
    throw new Error("Le montant de la remise dépasse la capacité de calcul.");
  }
  const discount = roundMoney(discountRaw);
  const taxableAmount = roundMoney(subtotal - discount);
  const taxRaw = taxableAmount * (taxRate / 100);
  if (!Number.isFinite(taxRaw)) {
    throw new Error("Le montant de la taxe dépasse la capacité de calcul.");
  }
  const tax = roundMoney(taxRaw);
  const totalRaw = taxableAmount + tax;
  if (!Number.isFinite(totalRaw)) {
    throw new Error("Le total dépasse la capacité de calcul.");
  }
  const total = roundMoney(totalRaw);

  return {
    quantity: input.quantity,
    unitPrice: roundMoney(input.unitPrice),
    subtotal,
    discount,
    taxableAmount,
    tax,
    total,
  };
}
