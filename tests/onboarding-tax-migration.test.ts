import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("forward-only D-09 onboarding tax regime", () => {
  const historical=readFileSync("supabase/migrations/20261113184000_create_company_onboarding.sql","utf8");
  const forward=readFileSync("supabase/migrations/20261127092000_company_onboarding_optional_tax_regime.sql","utf8");
  it("keeps the already-applied historical migration unchanged",()=>{
    expect(historical).toContain("or v_regime not in ('IR','IS','A_VERIFIER')");
    expect(historical).toContain("income_tax_regime=v_regime,");
    expect(historical).not.toContain("income_tax_regime=nullif(v_regime,'')");
  });
  it("accepts a blank regime and stores it as NULL in a forward migration",()=>{
    expect(forward).toContain("or v_regime not in ('','IR','IS','A_VERIFIER')");
    expect(forward).toContain("income_tax_regime=nullif(v_regime,'')");
  });
});
