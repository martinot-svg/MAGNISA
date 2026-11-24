import { describe, expect, it } from "vitest";
import { calculateNextRenewalDate } from "../src/lib/magnisa-upgrade/renewal";

describe("calculateNextRenewalDate", () => {
  it("clamps end-of-month dates", () => {
    expect(calculateNextRenewalDate(new Date("2026-01-31T12:00:00Z"), "monthly").toISOString())
      .toBe("2026-02-28T12:00:00.000Z");
  });

  it("uses UTC calendar dates consistently", () => {
    expect(calculateNextRenewalDate(new Date("2026-03-31T23:30:00Z"), "monthly").toISOString())
      .toBe("2026-04-30T23:30:00.000Z");
  });

  it("rejects an invalid date", () => {
    expect(() => calculateNextRenewalDate(new Date("invalid"), "monthly")).toThrow(/Invalid start date/);
  });
});
