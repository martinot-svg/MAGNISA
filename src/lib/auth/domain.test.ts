import { describe, expect, it } from "vitest";
import { signupEmailPolicy, isAllowedSignupEmail } from "./domain";

describe("MAGNISA personal email providers", () => {
  it("allows Gmail, Outlook, Yahoo, Proton and business domains", () => {
    for(const email of ["person@gmail.com","person@outlook.com","person@yahoo.fr","person@proton.me","finance@entreprise.mg"]) {
      expect(signupEmailPolicy(email).ok).toBe(true);
      expect(isAllowedSignupEmail(email)).toBe(true);
    }
  });
  it("refuses obvious disposable and malformed addresses", () => {
    for(const email of ["person@mailinator.com","person@yopmail.com","invalid","missing@domain"]) {
      expect(signupEmailPolicy(email).ok).toBe(false);
    }
  });
});
