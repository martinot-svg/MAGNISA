import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("majority enforcement CI fixtures", () => {
  const helper = readFileSync("scripts/ci/majority-fixtures.mjs", "utf8");
  const scripts = [
    "scripts/ci/orbit-action-tasks-integration.mjs",
    "scripts/ci/orbit-domain-requests-integration.mjs",
    "scripts/ci/orbit-action-ui-smoke.mjs",
    "scripts/ci/magnibox-free-platform-domain-integration.mjs",
    "scripts/ci/magnibox-agenda-integration.mjs",
    "scripts/ci/orbit-inbox-public-identity-integration.mjs",
    "scripts/ci/magnibox-internal-ui-smoke.mjs",
    "scripts/ci/magnibox-inbound-api-integration.mjs",
    "scripts/ci/magnibox-internal-mail-integration.mjs",
    "scripts/ci/magnisa-identity-integration.mjs",
    "scripts/magnibox/attachment-worker-integration.mjs",
  ];

  it("uses the service-role RPC rather than exposing the private schema over REST", () => {
    expect(helper).toContain('admin.rpc("stage_magnisa_signup_age"');
    expect(helper).toContain('admin.rpc("register_magnisa_signup_age"');
    expect(helper).not.toContain('admin.from("magnisa_signup_age_checks")');
  });

  it("stages each synthetic identity before the Auth insert trigger", () => {
    for (const path of scripts) {
      expect(readFileSync(path, "utf8"), path).toContain("stageAdultMajorityFixture");
    }
  });

  it("uses valid SQL dollar quoting and retains the private-age invitation test", () => {
    const sql = readFileSync("supabase/tests/organization-invitation-acceptance-integration.sql", "utf8");
    expect(sql).toContain("INSERT INTO private.magnisa_signup_age_pending");
    expect(sql).toContain("DO $$");
    expect(sql).not.toContain("DO $\n");
    expect(sql).toContain("Confirmed user without a majority record");
  });

  it("validates the existing-account date using a normal YYYY-MM-DD regex", () => {
    const action = readFileSync("src/server/actions/auth.ts", "utf8");
    const index = action.indexOf("export async function verifyMajorityForExistingAccount");
    const section = action.slice(index, index + 500);
    expect(section).toContain(String.raw`birth_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),`);
  });
});
