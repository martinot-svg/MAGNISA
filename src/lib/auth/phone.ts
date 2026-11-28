import metadata from "@/data/international-phone-metadata.json";

/**
 * Country calling codes and mobile-number validation patterns are generated
 * from Google's libphonenumber PhoneNumberMetadata.xml (Apache-2.0).
 * Source snapshot: 2026-11-18. Keep this file synchronized with that source.
 */
export type SignupPhoneCountry = {
  iso2: string;
  dialCode: string;
  mobilePattern: string | null;
  mobileLengths: number[];
};

export const SIGNUP_PHONE_COUNTRIES = metadata as unknown as readonly SignupPhoneCountry[];
export const MADAGASCAR_PHONE_PREFIXES = ["032","033","034","035","036","037","038","039"] as const;

export function getSignupPhoneCountry(countryIso2: string): SignupPhoneCountry | undefined {
  return SIGNUP_PHONE_COUNTRIES.find(item => item.iso2 === countryIso2);
}

export function getSignupPhoneDialCode(countryIso2: string): string {
  return getSignupPhoneCountry(countryIso2)?.dialCode ?? "";
}

/** Validate against the selected ISO country, not only its calling code. */
export function normalizeSignupPhone(
  countryIso2: string,
  prefix: string,
  national: string,
): { country: string; e164: string } | null {
  const country = getSignupPhoneCountry(countryIso2);
  if (!country || !country.mobilePattern || !/^[0-9]+$/.test(national)) return null;

  let nationalSignificantNumber = national;
  if (countryIso2 === "MG") {
    if (!(MADAGASCAR_PHONE_PREFIXES as readonly string[]).includes(prefix) || !/^[0-9]{7}$/.test(national)) return null;
    nationalSignificantNumber = prefix.slice(1) + national;
  } else if (prefix !== "") {
    return null;
  }

  if (!country.mobileLengths.includes(nationalSignificantNumber.length)) return null;
  if (!new RegExp(`^(?:${country.mobilePattern})$`).test(nationalSignificantNumber)) return null;

  const e164Digits = country.dialCode + nationalSignificantNumber;
  if (e164Digits.length > 15) return null;
  return { country: countryIso2, e164: `+${e164Digits}` };
}
