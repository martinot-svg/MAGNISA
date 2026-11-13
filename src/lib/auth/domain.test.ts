import { describe, expect, it } from "vitest";
import { signupEmailPolicy, isAllowedSignupEmail } from "./domain";

describe("Inscription MAGNISA indépendante de Google", () => {
  it.each([
    "utilisateur@gmail.com",
    "utilisateur@outlook.com",
    "utilisateur@hotmail.com",
    "utilisateur@yahoo.fr",
    "utilisateur@icloud.com",
    "utilisateur@proton.me",
    "utilisateur@protonmail.com",
    "utilisateur@zoho.com",
    "finance@mitalia.digital",
    "contact@entreprise.mg",
  ])("accepte le fournisseur %s", (email) => {
    expect(signupEmailPolicy(email).ok).toBe(true);
    expect(isAllowedSignupEmail(email)).toBe(true);
  });

  it("normalise une adresse réelle sans la lier à Gmail", () => {
    expect(signupEmailPolicy("  CONTACT@OUTLOOK.COM ")).toMatchObject({
      ok: true,
      normalized: "contact@outlook.com",
    });
  });

  it.each([
    "sans-arobase",
    "nom@",
    "@entreprise.mg",
    "nom@invalid",
    "nom@-entreprise.mg",
    "nom@entreprise..mg",
    "nom@mailinator.com",
    "nom@yopmail.com",
  ])("refuse l'adresse invalide ou jetable %s", (email) => {
    expect(signupEmailPolicy(email).ok).toBe(false);
  });
});
