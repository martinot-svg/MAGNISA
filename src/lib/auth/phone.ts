export type SignupPhoneCountry = { iso2: string; dialCode: string; minLength: number; maxLength: number };
export const SIGNUP_PHONE_COUNTRIES: readonly SignupPhoneCountry[] = [
  {iso2:"MG",dialCode:"261",minLength:10,maxLength:10},
  {iso2:"FR",dialCode:"33",minLength:9,maxLength:9},{iso2:"RE",dialCode:"262",minLength:9,maxLength:9},
  {iso2:"MU",dialCode:"230",minLength:8,maxLength:8},{iso2:"KM",dialCode:"269",minLength:7,maxLength:7},
  {iso2:"ZA",dialCode:"27",minLength:9,maxLength:9},{iso2:"SN",dialCode:"221",minLength:9,maxLength:9},
  {iso2:"KE",dialCode:"254",minLength:9,maxLength:9},{iso2:"GB",dialCode:"44",minLength:10,maxLength:10},
  {iso2:"US",dialCode:"1",minLength:10,maxLength:10},{iso2:"CA",dialCode:"1",minLength:10,maxLength:10},
  {iso2:"DE",dialCode:"49",minLength:10,maxLength:11},{iso2:"IT",dialCode:"39",minLength:9,maxLength:10},
  {iso2:"ES",dialCode:"34",minLength:9,maxLength:9},{iso2:"CH",dialCode:"41",minLength:9,maxLength:9},
  {iso2:"AE",dialCode:"971",minLength:9,maxLength:9},{iso2:"IN",dialCode:"91",minLength:10,maxLength:10},
  {iso2:"CN",dialCode:"86",minLength:11,maxLength:11},{iso2:"JP",dialCode:"81",minLength:10,maxLength:10},
  {iso2:"AU",dialCode:"61",minLength:9,maxLength:9},
] as const;
export const MADAGASCAR_PHONE_PREFIXES = ["032","033","034","035","036","037","038","039"] as const;
export function normalizeSignupPhone(countryIso2: string, prefix: string, national: string): {country:string;e164:string}|null {
  const country = SIGNUP_PHONE_COUNTRIES.find(item => item.iso2 === countryIso2);
  if (!country || !/^[0-9]+$/.test(national)) return null;
  if (countryIso2 === "MG") {
    if (!(MADAGASCAR_PHONE_PREFIXES as readonly string[]).includes(prefix) || !/^[0-9]{7}$/.test(national)) return null;
    return {country:countryIso2,e164:"+" + country.dialCode + prefix.slice(1) + national};
  }
  if (prefix !== "" || national.length < country.minLength || national.length > country.maxLength || national.startsWith("0")) return null;
  return {country:countryIso2,e164:"+" + country.dialCode + national};
}
