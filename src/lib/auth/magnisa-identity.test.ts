import { describe, expect, it } from "vitest";
import { isValidRegistrationLocality, normalizeUsername, PUBLIC_ID_PATTERN, REGISTRATION_LOCALITIES, USERNAME_PATTERN } from "@/lib/auth/magnisa-identity";
describe("Identité MAGNISA", () => {
  it("conserve un numéro public composé exactement de 14 chiffres", () => {
    expect(PUBLIC_ID_PATTERN.test("73849206152843")).toBe(true);
    expect(PUBLIC_ID_PATTERN.test("261-601-00000001")).toBe(false);
    expect(PUBLIC_ID_PATTERN.test("1234567890123")).toBe(false);
  });
  it("normalise les noms utilisateurs et rejette les alias ambigus", () => {
    expect(normalizeUsername("  Francky.Kevin ")).toBe("francky.kevin");
    expect(USERNAME_PATTERN.test("francky.kevin")).toBe(true);
    for(const alias of ["ab","a-b","a b","a@b","équipe","01test"]) {
      expect(USERNAME_PATTERN.test(alias)).toBe(false);
    }
  });
  it("n'accepte que les codes géographiques enregistrés", () => {
    expect(REGISTRATION_LOCALITIES.length).toBeGreaterThan(4);
    expect(isValidRegistrationLocality("261","601")).toBe(true);
    expect(isValidRegistrationLocality("261","602")).toBe(true);
    expect(isValidRegistrationLocality("261","999")).toBe(false);
    expect(isValidRegistrationLocality("999","601")).toBe(false);
  });
});
