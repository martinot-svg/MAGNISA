/** Registration geography: only approved code pairs are accepted on server and in SQL.
 * Codes are never incorporated into the user-facing 14-digit public identifier.
 * Additional countries/localities require a reviewed database catalogue update. */
export const REGISTRATION_COUNTRY_CODE = "261" as const;
export const REGISTRATION_COUNTRY_NAME = "Madagascar";
export const REGISTRATION_LOCALITIES = [
  { code: "101", name: "Antananarivo" },
  { code: "110", name: "Antsirabe" },
  { code: "201", name: "Antsiranana" },
  { code: "301", name: "Fianarantsoa" },
  { code: "401", name: "Mahajanga" },
  { code: "501", name: "Toamasina" },
  { code: "601", name: "Toliara I" },
  { code: "602", name: "Toliara II" },
] as const;
export const USERNAME_PATTERN = /^[a-z][a-z0-9._]{2,29}$/;
export const PUBLIC_ID_PATTERN = /^[0-9]{14}$/;

export function normalizeUsername(input: string): string {
  return input.trim().toLowerCase();
}
export function isValidRegistrationLocality(country: string, locality: string): boolean {
  return country === REGISTRATION_COUNTRY_CODE &&
    REGISTRATION_LOCALITIES.some((item) => item.code === locality);
}
