import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("signup majority privacy and duplicate-account safeguards", () => {
  const action = readFileSync("src/server/actions/auth.ts", "utf8");
  const migration = readFileSync("supabase/migrations/20261127090000_signup_private_age_check.sql", "utf8");
  it("does not put date of birth in Supabase user metadata", () => {
    expect(action).toContain("stage_magnisa_signup_age");
    expect(action).not.toMatch(/data:\s*\{[^}]*birth_date/s);
  });
  it("does not update age information for an existing identity", () => {
    expect(action).toContain("data.user.identities.length === 0");
    expect(migration).toContain("on conflict(user_id) do nothing");
    expect(migration).toContain("magnisa_consume_pending_signup_age");
    expect(migration).toContain("after insert on auth.users");
  });
  it("restricts age registration to service-role execution", () => {
    expect(migration).toContain("auth.jwt())->>'role','') <> 'service_role'");
    expect(migration).toContain("from public,anon,authenticated");
    expect(migration).toContain("to service_role");
  });
});
