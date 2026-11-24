import { describe, expect, it } from "vitest";
import { calculateNextRenewalDate } from "../src/lib/magnisa-upgrade/renewal";

describe("calculateNextRenewalDate", () => {
  it("clamps end-of-month dates", () => {
    expect(calculateNextRenewalDate(new Date("2026-01-31T12:00:00Z"), "monthly").toISOString())
      .toBe("2026-02-28T12:00:00.000Z");
  });
});
