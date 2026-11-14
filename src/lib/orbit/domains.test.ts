import { describe, expect, it } from "vitest";
import { normalizeOrbitDomain, normalizeOrbitLocalPart, normalizeOrbitPublicAddress } from "./domains";

describe("Magnisa Inbox : domaines personnalisables en attente de vérification", () => {
  it.each([
    ["entreprise.mg","entreprise.mg"],
    ["ENTREPRISE.COM","entreprise.com"],
    ["services.entreprise.org","services.entreprise.org"],
    ["support.entreprise.fr","support.entreprise.fr"],
    ["xxxx.xxx","xxxx.xxx"],
    ["sous.domaine.io","sous.domaine.io"],
  ])("accepte un domaine multi-extensions %s", (input, expected) => {
    expect(normalizeOrbitDomain(input)).toBe(expected);
  });
  it.each(["https://entreprise.mg","@entreprise.mg","domaine",".com","entreprise..mg","-abc.com","abc.com."," abc .com "])
    ("rejette le domaine incorrect %s", input => {
      expect(() => normalizeOrbitDomain(input)).toThrow();
    });
  it("accepte des adresses professionnelles et les normalise", () => {
    expect(normalizeOrbitPublicAddress("Prenom.Nom@ENTREPRISE.MG"))
      .toEqual({ email:"prenom.nom@entreprise.mg",localPart:"prenom.nom",domain:"entreprise.mg" });
    expect(normalizeOrbitLocalPart("finance")).toBe("finance");
    expect(normalizeOrbitLocalPart("x")).toBe("x");
  });
  it.each(["a..b","abc@",".prenom","prenom.","prenom nom","a/finance"])
    ("rejette l'identifiant mail incorrect %s",input => {
      expect(() => normalizeOrbitLocalPart(input)).toThrow();
    });
  it("n'assimile pas la syntaxe d'une adresse à une preuve d'activation", () => {
    expect(normalizeOrbitPublicAddress("finance@entreprise.com").email).toBe("finance@entreprise.com");
  });
});
