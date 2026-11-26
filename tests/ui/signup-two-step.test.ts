import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("MAGNISA signup progression", () => {
  const source = readFileSync("src/app/signup/page.tsx", "utf8");

  it("separates identity details from password setup", () => {
    expect(source).toContain("Étape 1 sur 2");
    expect(source).toContain("Étape 2 sur 2");
    expect(source).toContain('name="password"');
    expect(source).toContain('name="confirm_password"');
  });

  it("validates identity fields before allowing the password step", () => {
    expect(source).toContain(`querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(":invalid")`);
    expect(source).toContain("invalidField.reportValidity()");
    expect(source).toContain("setStep(2)");
  });

  it("keeps registration location in step one and password controls in step two", () => {
    const identityStart = source.indexOf('<fieldset ref={identityFieldsRef}');
    const identityEnd = source.indexOf("</fieldset>", identityStart);
    const passwordStart = source.indexOf('<fieldset hidden={step !== 2}');
    expect(identityStart).toBeGreaterThanOrEqual(0);
    expect(passwordStart).toBeGreaterThan(identityEnd);
    expect(source.indexOf('name="region_code"')).toBeGreaterThan(identityStart);
    expect(source.indexOf('name="locality_name"')).toBeGreaterThan(identityStart);
  });

  it("keeps the existing server action as the only account-creation path", () => {
    expect(source).toContain('<form action={action} className="form" onSubmit={event => {');
    expect(source).toContain('type="submit"');
    expect(source).toContain("signUp");
  });
});
