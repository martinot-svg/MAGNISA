import { describe, expect, it } from "vitest";
import {
  BILLING_UNITS,
  getBillingUnitLabel,
  isBillingUnit,
  mapLegacyBillingUnit,
} from "../../src/lib/magnisa-next/billing-units";

describe("billing units", () => {
  it("expose les 17 unités attendues", () => {
    expect(BILLING_UNITS).toHaveLength(17);
    expect(BILLING_UNITS.some((unit) => unit.value === "nuitee")).toBe(true);
  });

  it("valide les identifiants stables", () => {
    expect(isBillingUnit("heure")).toBe(true);
    expect(isBillingUnit("unité libre")).toBe(false);
    expect(getBillingUnitLabel("nuitee")).toBe("Nuitée");
  });

  it("mappe les unités historiques connues sans inventer de correspondance", () => {
    expect(mapLegacyBillingUnit("Nuitée")).toBe("nuitee");
    expect(mapLegacyBillingUnit("jour")).toBe("jour");
    expect(mapLegacyBillingUnit("trimestre")).toBeNull();
  });
});
