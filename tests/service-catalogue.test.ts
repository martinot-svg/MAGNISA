import { describe, expect, it } from "vitest";
import { SERVICE_UNITS, getServiceUnit } from "../src/lib/service-catalogue/units";
import { validateCategory, validateService } from "../src/lib/service-catalogue/validation";
import { calculateServiceLine, formatMGA } from "../src/lib/service-catalogue/price";

describe("service catalogue units", () => {
  it("exposes the seven requested units", () => {
    expect(SERVICE_UNITS.map((unit) => unit.code)).toEqual([
      "HOUR", "NIGHT", "DAY", "HALF_DAY", "WEEK", "MONTH", "PACKAGE",
    ]);
  });

  it("resolves unit metadata", () => {
    expect(getServiceUnit("HALF_DAY")?.label).toBe("Demi-journée");
    expect(getServiceUnit("UNKNOWN")).toBeUndefined();
  });
});

describe("catalogue validation", () => {
  it("requires a category name and company", () => {
    expect(validateCategory({ company_id: "", name: " " })).toHaveLength(2);
  });

  it("rejects negative price and invalid VAT", () => {
    const errors = validateService({
      company_id: "company-1",
      category_id: "category-1",
      name: "Assistance",
      unit_code: "HOUR",
      unit_price_mga: -1,
      vat_rate: 120,
    });
    expect(errors).toContain("Le prix unitaire doit être un montant positif ou nul.");
    expect(errors).toContain("Le taux de TVA doit être compris entre 0 et 100.");
  });

  it("accepts a valid service", () => {
    expect(validateService({
      company_id: "company-1",
      category_id: "category-1",
      name: "Maintenance informatique",
      unit_code: "HOUR",
      unit_price_mga: 25000,
      vat_rate: 0,
    })).toEqual([]);
  });
});

describe("service line pricing", () => {
  it("calculates subtotal, VAT and total", () => {
    expect(calculateServiceLine({ quantity: 2, unitPriceMGA: 25000, vatRate: 20 }))
      .toEqual({ subtotal: 50000, tax: 10000, total: 60000 });
  });

  it("formats MGA amounts", () => {
    expect(formatMGA(25000)).toContain("25");
  });
});
