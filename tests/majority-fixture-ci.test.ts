import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
describe("organization invitation majority SQL fixture",()=>{
 const sql=readFileSync("supabase/tests/organization-invitation-acceptance-integration.sql","utf8");
 it("seeds a majority record only for the adult acceptance fixture",()=>{
  expect(sql).toContain("INSERT INTO private.magnisa_signup_age_checks");
  expect(sql).toContain("'10000000-0000-4000-8000-000000000101'");
 });
 it("uses valid PL/pgSQL delimiters and tests missing-majority rejection",()=>{
  expect(sql).toContain("DO $$");
  expect(sql).not.toContain("DO $\n");
  expect(sql).toContain("Confirmed user without a majority record");
 });
});
