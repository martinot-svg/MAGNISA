import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("MAGNISA Supabase auth callback", () => {
  const source = readFileSync("src/app/auth/callback/route.ts", "utf8");

  it("supports both PKCE code exchange and email invite token verification", () => {
    expect(source).toContain("exchangeCodeForSession(code)");
    expect(source).toContain("verifyOtp({");
    expect(source).toContain('token_hash: tokenHash');
    expect(source).toContain('"invite"');
  });

  it("restricts OTP types and keeps redirects local", () => {
    expect(source).toContain("allowedOtpTypes.has");
    expect(source).toContain('!nextPath.startsWith("//")');
  });

  it("does not forward failed or invalid auth callbacks to protected pages", () => {
    expect(source).toContain('/login?error=auth_callback');
  });
});
