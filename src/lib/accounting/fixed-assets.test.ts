import { describe, expect, it } from "vitest";
import { calculateStraightLineDepreciation } from "./fixed-assets";

describe("calculateStraightLineDepreciation", () => {
  it("calculates full-year straight-line depreciation and residual value", () => {
    const result = calculateStraightLineDepreciation({
      acquisitionCost: 60_000_000,
      residualValue: 6_000_000,
      usefulLifeMonths: 60,
      inServiceDate: "2025-01-01",
      periodStart: "2025-01-01",
      periodEnd: "2025-12-31",
    });
    expect(result.depreciableBase).toBe(54_000_000);
    expect(result.depreciationCharge).toBe(10_800_000);
    expect(result.closingAccumulatedDepreciation).toBe(10_800_000);
    expect(result.closingNetBookValue).toBe(49_200_000);
  });

  it("does not depreciate before the asset is in service", () => {
    const result = calculateStraightLineDepreciation({
      acquisitionCost: 12_000,
      usefulLifeMonths: 12,
      inServiceDate: "2025-07-01",
      periodStart: "2025-01-01",
      periodEnd: "2025-06-30",
    });
    expect(result.depreciationCharge).toBe(0);
    expect(result.closingAccumulatedDepreciation).toBe(0);
  });

  it("caps depreciation at the end of useful life", () => {
    const result = calculateStraightLineDepreciation({
      acquisitionCost: 12_000,
      usefulLifeMonths: 12,
      inServiceDate: "2025-01-01",
      periodStart: "2025-12-01",
      periodEnd: "2026-01-31",
    });
    expect(result.closingAccumulatedDepreciation).toBe(12_000);
    expect(result.closingNetBookValue).toBe(0);
  });

  it("includes directly attributable cost in depreciable base", () => {
    const result = calculateStraightLineDepreciation({
      acquisitionCost: 10_000,
      directlyAttributableCost: 2_000,
      residualValue: 2_000,
      usefulLifeMonths: 12,
      inServiceDate: "2025-01-01",
      periodStart: "2025-01-01",
      periodEnd: "2025-12-31",
    });
    expect(result.depreciableBase).toBe(10_000);
    expect(result.closingNetBookValue).toBe(2_000);
  });

  it("rejects invalid useful life and invalid residual value", () => {
    const base = {
      acquisitionCost: 1_000,
      inServiceDate: "2025-01-01",
      periodStart: "2025-01-01",
      periodEnd: "2025-12-31",
    };
    expect(() => calculateStraightLineDepreciation({ ...base, usefulLifeMonths: 0 })).toThrow();
    expect(() => calculateStraightLineDepreciation({ ...base, usefulLifeMonths: 12, residualValue: 2_000 })).toThrow();
  });
});
