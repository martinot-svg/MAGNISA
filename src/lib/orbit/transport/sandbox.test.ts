import { describe, expect, it } from "vitest";
import { enabledResendSandboxDomain, matchesResendSandboxDomain } from "./sandbox";

describe("Resend inbound sandbox - zero tenant writes",()=>{
  const env={
    MAGNIBOX_RESEND_SANDBOX_ENABLED:"true",
    MAGNIBOX_RESEND_SANDBOX_DOMAIN:"tolokroneu.resend.app",
    MAGNIBOX_EXTERNAL_MAIL_ENABLED:"false",
  } as NodeJS.ProcessEnv;
  it("authorizes only an explicitly configured Resend domain while public mail is off",()=>{
    expect(enabledResendSandboxDomain(env)).toBe("tolokroneu.resend.app");
    expect(enabledResendSandboxDomain({...env,MAGNIBOX_EXTERNAL_MAIL_ENABLED:"true"})).toBeNull();
    expect(enabledResendSandboxDomain({...env,MAGNIBOX_RESEND_SANDBOX_ENABLED:"false"})).toBeNull();
    expect(enabledResendSandboxDomain({...env,MAGNIBOX_RESEND_SANDBOX_DOMAIN:"example.com"})).toBeNull();
    expect(enabledResendSandboxDomain({...env,MAGNIBOX_RESEND_SANDBOX_DOMAIN:"foo.bar.resend.app"})).toBeNull();
  });
  it("accepts aliases of the exact configured domain only",()=>{
    expect(matchesResendSandboxDomain(["contact@tolokroneu.resend.app"],"tolokroneu.resend.app")).toBe(true);
    expect(matchesResendSandboxDomain(["direction@tolokroneu.resend.app","SUPPORT@TOLOKRONEU.RESEND.APP"],"tolokroneu.resend.app")).toBe(true);
    expect(matchesResendSandboxDomain(["contact@other.resend.app"],"tolokroneu.resend.app")).toBe(false);
    expect(matchesResendSandboxDomain(["contact@tolokroneu.resend.app.evil.example"],"tolokroneu.resend.app")).toBe(false);
    expect(matchesResendSandboxDomain(["contact@tolokroneu.resend.app","intruder@example.com"],"tolokroneu.resend.app")).toBe(false);
    expect(matchesResendSandboxDomain([],"tolokroneu.resend.app")).toBe(false);
  });
});
