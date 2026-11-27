import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
describe("majority-aware integration fixtures",()=>{
 const sql=readFileSync("supabase/tests/organization-invitation-acceptance-integration.sql","utf8");
 const worker=readFileSync("scripts/magnibox/attachment-worker-integration.mjs","utf8");
 const helper=readFileSync("scripts/ci/majority-fixtures.mjs","utf8");
 it("uses service-role RPCs, not private-table REST access",()=>{
  expect(helper).toContain('admin.rpc("stage_magnisa_signup_age"');
  expect(helper).toContain('admin.rpc("register_magnisa_signup_age"');
  expect(helper).not.toContain('admin.from("magnisa_signup_age_checks")');
 });
 it("stages both attachment worker identities before Auth creation",()=>{
  expect(worker).toContain("stageAdultMajorityFixture(admin,email)");
  expect(worker).toContain("seedAdultMajorityFixture(admin, created.userId)");
  expect(worker).toContain("stageAdultMajorityFixture(admin,secondEmail)");
  expect(worker).toContain("seedAdultMajorityFixture(admin, created.secondUserId)");
  expect(worker).not.toContain('admin.from("magnisa_signup_age_checks")');
 });
 it("stages completed-signup SQL fixtures before auth.users insert",()=>{
  expect(sql.indexOf("private.magnisa_signup_age_pending")).toBeLessThan(sql.indexOf("INSERT INTO auth.users"));
  expect(sql).not.toContain("INSERT INTO private.magnisa_signup_age_checks");
 });
 it("creates the invited no-age account before switching to authenticated",()=>{
  const user=sql.indexOf("'invite-no-age@magnisa.test', now(), now(), now(), now(),");
  expect(user).toBeGreaterThanOrEqual(0);
  expect(user).toBeLessThan(sql.indexOf("SET LOCAL ROLE authenticated"));
 });
 it("uses valid PL/pgSQL delimiters and preserves majority rejection",()=>{
  expect(sql).toContain("DO $$");
  expect(sql).not.toContain("DO $\\n");
  expect(sql).toContain("A confirmed account without a server-side age record must not accept an invitation");
  expect((sql.match(/\\$\\$/g)||[]).length%2).toBe(0);
 });
});
