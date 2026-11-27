import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("majority gate for existing and direct-signup accounts",()=>{
  const guard=readFileSync("src/lib/current-org.ts","utf8");
  const action=readFileSync("src/server/actions/auth.ts","utf8");
  const page=readFileSync("src/app/verify-majority/page.tsx","utf8");
  const migration=readFileSync("supabase/migrations/20261127095000_majority_gate_app_and_organization.sql","utf8");
  it("redirects authenticated users without a private age record to completion",()=>{
    expect(guard).toContain("has_magnisa_signup_age_check");
    expect(guard).toContain('redirect("/verify-majority")');
    expect(page).toContain("email_confirmed_at");
  });
  it("registers majority only through a server-side service-role action",()=>{
    expect(action).toContain("verifyMajorityForExistingAccount");
    expect(action).toContain("register_magnisa_signup_age");
    expect(migration).toContain("grant execute on function public.has_magnisa_signup_age_check() to authenticated");
  });
  it("protects the organization-creation RPC itself",()=>{
    expect(migration).toContain("public.create_organization");
    expect(migration).toContain("private.magnisa_signup_age_checks");
  });
});
