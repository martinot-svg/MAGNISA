import { describe, expect, it } from "vitest";
import {
  internalMailboxLabel,
  normalizemagniboxLocalPart,
  normalizemagniboxNamespace,
} from "./internal-address";

describe("Identifiants privés de magnibox", () => {
  it("forme une adresse interne de service et une adresse nominative", () => {
    expect(internalMailboxLabel(" Finance ", " Mitalia ")).toBe("finance (mitalia)");
    expect(internalMailboxLabel("aina", "mitalia")).toBe("aina (mitalia)");
  });

  it("n'affiche pas d'adresse Internet fictive", () => {
    const label = internalMailboxLabel("finance", "societe-exemple");
    expect(label).toBe("finance (societe-exemple)");
    expect(label).not.toContain("@");
  });

  it("accepte des identifiants d'entreprise avec tiret et des boîtes personnalisées", () => {
    expect(normalizemagniboxNamespace("mitalia-digital")).toBe("mitalia-digital");
    expect(normalizemagniboxLocalPart("service.compta")).toBe("service.compta");
  });

  it.each([
    "mitalia.digital", "mitalia@gmail.com", "-mitalia",
    "mitalia-", "mita lia", "mitalia_1",
  ])("rejette la simulation d'un domaine Internet ou d'un espace invalide : %s", (slug) => {
    expect(() => normalizemagniboxNamespace(slug)).toThrow(/invalide/);
  });

  it.each([
    "finance@mitalia.mg", "a", ".admin", " finance externe ", "s€rvice",
  ])("rejette la création d'un alias hors du format interne : %s", (alias) => {
    expect(() => normalizemagniboxLocalPart(alias)).toThrow(/invalide/);
  });
});
