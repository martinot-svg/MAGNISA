import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("MAGNISA onboarding usage choices", () => {
  const source = readFileSync("src/app/onboarding/page.tsx", "utf8");

  it("offers organization creation and invitation-based team joining", () => {
    expect(source).toContain("Créer un espace pour mon organisation");
    expect(source).toContain('href="/creer-entreprise"');
    expect(source).toContain("Rejoindre une équipe");
    expect(source).toContain('href="/espace-personnel#invitations"');
  });

  it("shows personal finance as upcoming and leaves it non-interactive", () => {
    expect(source).toContain("Gérer mes finances personnelles");
    expect(source).toContain("Bientôt disponible");
    expect(source).toContain("<button className=\"button\" type=\"button\" disabled>");
  });

  it("keeps the existing personal account route accessible", () => {
    expect(source).toContain('href="/espace-personnel"');
  });
});
