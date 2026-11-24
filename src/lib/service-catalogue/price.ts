/** Calcule les montants d'une ligne de prestation. Tous les montants sont en MGA. */
export function calculateServiceLine(input: {
  quantity: number;
  unitPriceMGA: number;
  vatRate: number;
}) {
  if (!Number.isFinite(input.quantity) || input.quantity < 0) {
    throw new Error("La quantité doit être positive ou nulle.");
  }
  if (!Number.isFinite(input.unitPriceMGA) || input.unitPriceMGA < 0) {
    throw new Error("Le prix unitaire doit être positif ou nul.");
  }
  if (!Number.isFinite(input.vatRate) || input.vatRate < 0 || input.vatRate > 100) {
    throw new Error("Le taux de TVA doit être compris entre 0 et 100.");
  }

  const subtotal = roundMGA(input.quantity * input.unitPriceMGA);
  const tax = roundMGA(subtotal * input.vatRate / 100);
  return { subtotal, tax, total: roundMGA(subtotal + tax) };
}

export function roundMGA(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function formatMGA(value: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "MGA",
    maximumFractionDigits: 2,
  }).format(value);
}
