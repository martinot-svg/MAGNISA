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
  const total = input.amount * multiplier;
  if (!Number.isFinite(total)) {
    throw new Error("calculated price exceeds the supported numeric range");
  }
  const rounded = Math.round((total + Number.EPSILON) * 100) / 100;
  if (!Number.isFinite(rounded)) {
    throw new Error("calculated price exceeds the supported numeric range");
  }
  return rounded;
}
