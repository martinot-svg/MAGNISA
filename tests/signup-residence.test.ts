import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("MAGNISA international residence", () => {
  const signup = readFileSync("src/app/signup/page.tsx", "utf8");
  const action = readFileSync("src/server/actions/auth.ts", "utf8");
  const migration = readFileSync("supabase/migrations/20261128100000_private_user_residence.sql", "utf8");
  const profile = readFileSync("src/app/(app)/mon-profil/page.tsx", "utf8");

  it("offers a searchable international country selector and separate region/locality fields", () => {
    expect(signup).toContain('name="residence_country_iso2"');
    expect(signup).toContain("filteredResidenceCountries");
    expect(signup).toContain('name="residence_region_name"');
    expect(signup).toContain('name="residence_locality_name"');
  });

  it("stores residence separately and does not confuse it with immutable registration origin", () => {
    expect(action).toContain('register_magnisa_signup_residence');
    expect(action).not.toContain('register_magnisa_signup_location');
    expect(migration).toContain("private.magnisa_user_residence");
    expect(migration).toContain("User-editable residence data, separate from immutable private registration origin");
  });

  it("keeps residence private and provides authenticated own-record read/update RPCs", () => {
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("get_magnisa_user_residence");
    expect(migration).toContain("update_magnisa_user_residence");
    expect(migration).toContain("auth.uid()");
    expect(profile).toContain('get_magnisa_user_residence');
    expect(profile).toContain('update_magnisa_user_residence');
  });
});
