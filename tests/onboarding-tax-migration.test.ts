import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
describe("optional tax regime migration",()=>{
 it("accepts an empty tax regime and persists NULL",()=>{
  const sql=readFileSync("supabase/migrations/20261127092000_company_onboarding_optional_tax_regime.sql","utf8");
  expect(sql).toContain("or v_regime not in ('','IR','IS','A_VERIFIER')");
  expect(sql).toContain("income_tax_regime=nullif(v_regime,'')");
 });
 it("does not mutate the checksum-controlled original onboarding migration",()=>{
  const sql=readFileSync("supabase/migrations/20261113184000_create_company_onboarding.sql","utf8");
  expect(sql).toContain("or v_regime not in ('IR','IS','A_VERIFIER')");
  expect(sql).toContain("income_tax_regime=v_regime,");
 });
});
