import { describe, expect, it } from "vitest";
import { isAtLeast18, isValidBirthDate } from "@/lib/auth/majority";

describe("signup majority validation", () => {
  const today = new Date("2026-11-27T00:00:00.000Z");
  it("accepts an exact 18th birthday and an older adult", () => {
    expect(isAtLeast18("2008-11-27", today)).toBe(true);
    expect(isAtLeast18("1990-01-01", today)).toBe(true);
  });
  it("rejects a person one day short of 18", () => {
    expect(isAtLeast18("2008-11-28", today)).toBe(false);
  });
  it("rejects future and impossible dates", () => {
    expect(isAtLeast18("2027-01-01", today)).toBe(false);
    expect(isValidBirthDate("2008-02-30")).toBe(false);
    expect(isValidBirthDate("not-a-date")).toBe(false);
  });
  it("uses the documented February 29 anniversary convention", () => {
    expect(isAtLeast18("2008-02-29", new Date("2026-02-28T00:00:00.000Z"))).toBe(true);
  });
});
