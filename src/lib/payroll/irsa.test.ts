import { describe, expect, it } from "vitest";
import { calculateIrsa, MADAGASCAR_IRSA_2026 } from "./irsa";

describe("Barème IRSA Madagascar 2026", () => {
  it("reproduit exactement les six tranches légales", () => {
    expect(MADAGASCAR_IRSA_2026.brackets).toEqual([
      { up_to: 350000, rate: 0 },
      { up_to: 400000, rate: 0.05 },
      { up_to: 500000, rate: 0.1 },
      { up_to: 600000, rate: 0.15 },
      { up_to: 4000000, rate: 0.2 },
      { up_to: null, rate: 0.25 },
    ]);
  });

  it.each([
    [0, 0],
    [350000, 3000],
    [350100, 3000],
    [400000, 3000],
    [400100, 3005],
    [500000, 12500],
    [600000, 27500],
    [4000000, 707500],
    [4000100, 707525],
    [5000000, 957500],
  ])("calcule une base imposable de %i Ar : %i Ar", (base, expected) => {
    expect(calculateIrsa({ taxableIncome: base }).tax).toBe(expected);
  });

  it("arrondit l'assiette à la centaine inférieure avant calcul", () => {
    const result = calculateIrsa({ taxableIncome: 400199 });
    expect(result.taxableBase).toBe(400100);
    expect(result.tax).toBe(3005);
  });

  it("applique 2 000 Ar par personne à charge au-delà de 350 000 Ar", () => {
    const result = calculateIrsa({ taxableIncome: 500000, dependants: 2 });
    expect(result.progressiveTax).toBe(12500);
    expect(result.dependantReduction).toBe(4000);
    expect(result.tax).toBe(8500);
  });

  it("ne réduit jamais l'impôt sous le minimum légal de 3 000 Ar", () => {
    expect(calculateIrsa({ taxableIncome: 400100, dependants: 30 }).tax).toBe(3000);
  });

  it("ne calcule pas de retenue sur une base imposable nulle", () => {
    expect(calculateIrsa({ taxableIncome: 0 }).tax).toBe(0);
  });

  it("rejette les bases, personnes à charge et barèmes invalides", () => {
    expect(() => calculateIrsa({ taxableIncome: -1 })).toThrow();
    expect(() => calculateIrsa({ taxableIncome: 400000, dependants: 1.5 })).toThrow();
    expect(() => calculateIrsa({
      taxableIncome: 400000,
      brackets: [{ up_to: 400000, rate: 0.05 }],
    })).toThrow();
  });
});
