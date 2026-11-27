import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("D-09 optional tax regime and D-01 invitation gate", () => {
  const schema=readFileSync("src/lib/company/onboarding-schema.ts","utf8");
  const wizard=readFileSync("src/components/company-creation-wizard.tsx","utf8");
  const migration=readFileSync("supabase/migrations/20261127091000_invitation_majority_gate.sql","utf8");
  const personal=readFileSync("src/app/espace-personnel/page.tsx","utf8");
  it("allows organization onboarding without a tax regime",()=>{
    expect(schema).toContain('z.enum(["","IS","IR","A_VERIFIER"]).default("")');
    expect(wizard).toContain("Je le renseignerai plus tard");
    expect(wizard).toContain('Régime fiscal déclaré (facultatif)');
  });
  it("requires age validation before server-side invitation acceptance",()=>{
    expect(personal).toContain("register_magnisa_signup_age");
    expect(personal).toContain("majority_confirmed");
    expect(migration).toContain("private.magnisa_signup_age_checks");
  });
});
