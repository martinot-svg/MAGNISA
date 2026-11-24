import { describe, expect, it } from "vitest";
import { calculatePrice } from "../src/lib/magnisa-upgrade/pricing";

describe("calculatePrice", () => {
  it("prices a fixed service once", () => {
    expect(calculatePrice({ amount: 125, quantity: 9, unit: "fixed" })).toBe(125);
  });
  it("multiplies variable units", () => {
    expect(calculatePrice({ amount: 25, quantity: 4, unit: "per_participant" })).toBe(100);
  });
  it("rejects negative amounts", () => {
    expect(() => calculatePrice({ amount: -1, quantity: 1, unit: "fixed" })).toThrow();
  });
  it("rejects a finite input whose multiplication overflows", () => {
    expect(() => calculatePrice({ amount: Number.MAX_VALUE, quantity: 2, unit: "hourly" })).toThrow(/numeric range/);
  });
});
