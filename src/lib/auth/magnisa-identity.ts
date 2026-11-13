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
// Legacy usernames remain valid for login and existing accounts.
export const USERNAME_PATTERN = /^[a-z][a-z0-9._]{2,29}$/;
// New user-facing handles: @ followed by 3-10 ASCII letters.
export const NEW_USERNAME_PATTERN = /^[a-z]{3,10}$/;

export function generateUsername(firstName: string, lastName: string): string {
  const letters = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]/g, "");
  const given = letters(firstName);
  const family = letters(lastName);
  // Keep some of both names when possible, even when the given name is long.
  const givenPart = given.slice(0, family ? Math.min(7, Math.max(3, 10 - Math.min(3, family.length))) : 10);
  return (givenPart + family).slice(0, 10);
}
export const PUBLIC_ID_PATTERN = /^[0-9]{14}$/;

export function normalizeUsername(input: string): string {
  return input.trim().replace(/^@/, "").toLowerCase();
}
export function isValidRegistrationLocality(country: string, locality: string): boolean {
  return country === REGISTRATION_COUNTRY_CODE &&
    REGISTRATION_LOCALITIES.some((item) => item.code === locality);
}
