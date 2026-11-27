import { describe, expect, it } from "vitest";
import { MADAGASCAR_PHONE_PREFIXES, normalizeSignupPhone } from "./phone";

describe("MAGNISA signup phone validation", () => {
  it("accepts all configured Madagascar operator prefixes with exactly seven remaining digits", () => {
    for (const prefix of MADAGASCAR_PHONE_PREFIXES) {
      expect(normalizeSignupPhone("MG", prefix, "1234567")?.e164).toBe("+261" + prefix.slice(1) + "1234567");
    }
  });
  it("rejects short, long, nonnumeric and unsupported Madagascar prefixes", () => {
    expect(normalizeSignupPhone("MG", "032", "123456")).toBeNull();
    expect(normalizeSignupPhone("MG", "032", "12345678")).toBeNull();
    expect(normalizeSignupPhone("MG", "032", "1234abc")).toBeNull();
    expect(normalizeSignupPhone("MG", "031", "1234567")).toBeNull();
  });
  it("normalizes supported international countries without a national trunk zero", () => {
    expect(normalizeSignupPhone("FR", "", "612345678")?.e164).toBe("+33612345678");
    expect(normalizeSignupPhone("US", "", "2125551234")?.e164).toBe("+12125551234");
  });
  it("rejects unknown countries, country-prefix mismatches and invalid national lengths", () => {
    expect(normalizeSignupPhone("XX", "", "123456789")).toBeNull();
    expect(normalizeSignupPhone("FR", "032", "612345678")).toBeNull();
    expect(normalizeSignupPhone("FR", "", "0612345678")).toBeNull();
    expect(normalizeSignupPhone("US", "", "12345")).toBeNull();
  });
});
