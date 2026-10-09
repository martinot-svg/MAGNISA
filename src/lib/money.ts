export const money = (value: number | string | null | undefined, currency = "MGA") => {
  const amount = Number(value ?? 0);
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
};

export function roundMoney(value: number) { return Math.round((value + Number.EPSILON) * 100) / 100; }

export function lineTotals(quantity: number, unitPrice: number, discountPct: number, taxPct: number) {
  if (quantity <= 0) throw new Error("La quantité doit être strictement positive.");
  if (unitPrice < 0) throw new Error("Le prix ne peut pas être négatif.");
  if (discountPct < 0 || discountPct > 100) throw new Error("La remise doit être comprise entre 0 et 100 %.");
  if (taxPct < 0) throw new Error("Le taux de taxe ne peut pas être négatif.");
  const gross = roundMoney(quantity * unitPrice);
  const discount = roundMoney(gross * discountPct / 100);
  const net = roundMoney(gross - discount);
  const tax = roundMoney(net * taxPct / 100);
  return { gross, discount, net, tax, total: roundMoney(net + tax) };
}
