import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("majority-aware integration test fixtures", () => {
  it("registers the MAGNIBOX synthetic user as adult before organization creation", () => {
    const source = readFileSync("scripts/magnibox/attachment-worker-integration.mjs", "utf8");
    const age = source.indexOf("magnisa_signup_age_checks");
    const org = source.indexOf('owner.rpc("create_organization"');
    expect(age).toBeGreaterThan(-1);
    expect(age).toBeLessThan(org);
  });
  it("seeds only the invitation acceptance fixture with a majority record", () => {
    const source = readFileSync("supabase/tests/organization-invitation-acceptance-integration.sql", "utf8");
    expect(source).toContain("INSERT INTO private.magnisa_signup_age_checks");
    expect(source).toContain("'10000000-0000-4000-8000-000000000101'");
    expect(source).not.toMatch(/DO \$(?:\r?\n)DECLARE/);
  });
});
