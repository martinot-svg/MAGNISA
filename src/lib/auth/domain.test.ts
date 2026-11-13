import { describe, expect, it } from "vitest";
import { isAllowedSignupEmail, signupEmailPolicy } from "@/lib/auth/domain";

describe("signupEmailPolicy", () => {
  it.each([
    "person@gmail.com",
    "person@outlook.com",
    "person@yahoo.fr",
    "person@icloud.com",
    "person@proton.me",
    "finance@entreprise.mg",
    "contact@entreprise.com",
  ])("accepts valid provider-independent address: %s", (email) => {
    expect(signupEmailPolicy(email)).toMatchObject({ ok: true });
    expect(isAllowedSignupEmail(email)).toBe(true);
  });

  it("normalizes surrounding whitespace and letter case", () => {
    expect(signupEmailPolicy("  Finance@Entreprise.MG  ")).toMatchObject({
      ok: true,
      normalized: "finance@entreprise.mg",
    });
  });

  it.each([
    "",
    "plain-address",
    "@example.com",
    "person@",
    "person@example",
    "person@@example.com",
    "person name@example.com",
    "person@mailinator.com",
    "person@tempmail.example",
  ])("rejects malformed or disposable address: %s", (email) => {
    expect(signupEmailPolicy(email).ok).toBe(false);
    expect(isAllowedSignupEmail(email)).toBe(false);
  });
});
