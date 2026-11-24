export type PricingUnit =
  | "fixed" | "hourly" | "daily" | "monthly" | "yearly"
  | "per_participant" | "per_session";

export interface PriceInput {
  amount: number;
  quantity: number;
  unit: PricingUnit;
}

export function calculatePrice(input: PriceInput): number {
  if (!Number.isFinite(input.amount) || input.amount < 0) {
    throw new Error("amount must be a finite non-negative number");
  }
  if (!Number.isFinite(input.quantity) || input.quantity < 0) {
    throw new Error("quantity must be a finite non-negative number");
  }
  const multiplier = input.unit === "fixed" ? 1 : input.quantity;
  return Math.round(input.amount * multiplier * 100) / 100;
}
