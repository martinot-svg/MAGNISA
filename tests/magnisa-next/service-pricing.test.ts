import { describe, expect, it } from "vitest";
import { calculateServicePrice } from "../../src/lib/magnisa-next/service-pricing";

describe("calculateServicePrice", () => {
  it("calcule quantité, remise et taxe", () => {
    expect(
      calculateServicePrice({
        unit: "heure",
        quantity: 3,
        unitPrice: 100,
        discountRate: 10,
        taxRate: 20,
      }),
    ).toEqual({
      quantity: 3,
      unitPrice: 100,
      subtotal: 300,
      discount: 30,
      taxableAmount: 270,
      tax: 54,
      total: 324,
    });
  });

  it("rejette les valeurs négatives et taux invalides", () => {
    expect(() =>
      calculateServicePrice({ unit: "jour", quantity: -1, unitPrice: 10 }),
    ).toThrow();
    expect(() =>
      calculateServicePrice({ unit: "jour", quantity: 1, unitPrice: 10, taxRate: 101 }),
    ).toThrow();
  });
});
