import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("majority enforcement CI fixtures", () => {
  const helper = readFileSync("scripts/ci/majority-fixtures.mjs", "utf8");
  const scripts = [
    "scripts/ci/automatic-username-integration.mjs",
    "scripts/ci/company-onboarding-browser-smoke.mjs",
    "scripts/ci/create-payroll-ui-user.mjs",
    "scripts/ci/crm-collaboration-integration.mjs",
    "scripts/ci/crm-ui-smoke.mjs",
    "scripts/ci/existing-tenant-isolation-integration.mjs",
    "scripts/ci/fixed-assets-rls-integration.mjs",
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

  it("imports and stages every synthetic Auth identity before its insert trigger", () => {
    for (const path of scripts) {
      const source = readFileSync(path, "utf8");
      const hasStageImport = source.split("\\n").some(
        (line) => line.startsWith("import ") && line.includes("stageAdultMajorityFixture"),
      );
      expect(hasStageImport, path + " must import the staging helper").toBe(true);
      const createCalls = source.split(".auth.admin.createUser(").length - 1;
      const stageCalls = source.split("stageAdultMajorityFixture(").length - 1;
      expect(stageCalls, path + " staged Auth identities").toBeGreaterThanOrEqual(createCalls);
      const firstCreate = source.indexOf(".auth.admin.createUser(");
      const firstStage = source.indexOf("stageAdultMajorityFixture(");
      expect(firstStage, path + " staging must precede Auth creation").toBeGreaterThanOrEqual(0);
      expect(firstCreate, path + " must create an Auth fixture").toBeGreaterThanOrEqual(0);
      expect(firstStage, path + " staging must precede Auth creation").toBeLessThan(firstCreate);
    }
  });

  it("stages every four-account IMAP fixture through the service-role RPC", () => {
    const imap = readFileSync("scripts/ci/seed-magnibox-imap-sync-lab.ts", "utf8");
    expect(imap).toContain('supabase.rpc("stage_magnisa_signup_age"');
    expect(imap).toContain('supabase.rpc("register_magnisa_signup_age"');
    expect(imap.indexOf('supabase.rpc("stage_magnisa_signup_age"')).toBeLessThan(
      imap.indexOf("supabase.auth.admin.createUser("),
    );
  });

  it("uses valid SQL dollar quoting and retains the private-age invitation test", () => {
    const sql = readFileSync("supabase/tests/organization-invitation-acceptance-integration.sql", "utf8");
    expect(sql).toContain("INSERT INTO private.magnisa_signup_age_pending");
    expect(sql).toContain("DO $$");
    expect(sql).not.toContain("DO $\n");
    expect(sql).toContain("A confirmed account without a server-side age record must not accept an invitation");
    expect(sql).toContain("'invite-no-age@magnisa.test'");
    expect(sql).toContain("invite-unconfirmed@magnisa.test");
    expect(sql).toContain("v_status <> 'invited'");
  });

  it("validates the existing-account date using a normal YYYY-MM-DD regex", () => {
    const action = readFileSync("src/server/actions/auth.ts", "utf8");
    const index = action.indexOf("export async function verifyMajorityForExistingAccount");
    const section = action.slice(index, index + 500);
    expect(section).toContain(String.raw`birth_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),`);
  });
});
