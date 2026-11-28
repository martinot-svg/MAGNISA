import { describe, expect, it } from "vitest";
import { MADAGASCAR_PHONE_PREFIXES, SIGNUP_PHONE_COUNTRIES, getSignupPhoneDialCode, normalizeSignupPhone } from "./phone";

describe("MAGNISA international signup phone validation", () => {
  it("loads the international territory catalogue and calling codes", () => {
    expect(SIGNUP_PHONE_COUNTRIES.length).toBeGreaterThanOrEqual(240);
    expect(getSignupPhoneDialCode("MG")).toBe("261");
    expect(getSignupPhoneDialCode("FR")).toBe("33");
    expect(getSignupPhoneDialCode("US")).toBe("1");
    expect(getSignupPhoneDialCode("CA")).toBe("1");
  });

  it("accepts all configured Madagascar operator prefixes with seven remaining digits", () => {
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

  it("validates mobile number patterns for international countries", () => {
    expect(normalizeSignupPhone("FR", "", "612345678")?.e164).toBe("+33612345678");
    expect(normalizeSignupPhone("US", "", "2125551234")?.e164).toBe("+12125551234");
    expect(normalizeSignupPhone("CA", "", "4165551234")?.country).toBe("CA");
  });

  it("keeps country selection explicit when calling codes are shared", () => {
    const us = normalizeSignupPhone("US", "", "2125551234");
    expect(us?.country).toBe("US");
    expect(us?.e164).toBe("+12125551234");
  });

  it("rejects unknown countries, prefix mismatches, invalid lengths and missing mobile metadata", () => {
    expect(normalizeSignupPhone("XX", "", "123456789")).toBeNull();
    expect(normalizeSignupPhone("FR", "032", "612345678")).toBeNull();
    expect(normalizeSignupPhone("FR", "", "0612345678")).toBeNull();
    expect(normalizeSignupPhone("US", "", "12345")).toBeNull();
    expect(normalizeSignupPhone("TA", "", "1234567")).toBeNull();
  });
});
