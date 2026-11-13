import { describe, expect, it } from "vitest";
import {
  defaultPreavisRules,
  normalizePreavisRules,
  parsePreavisRulesJson,
} from "./preavis-config";

describe("MGMail — configuration des préavis", () => {
  it("conserve des délais personnalisés et des niveaux de rappel distincts", () => {
    const rules = normalizePreavisRules([
      { daysBefore: 2, tone: "dernier", enabled: true, id: "id-du-client" },
      { daysBefore: 12, tone: "information", enabled: true },
      { daysBefore: 7, tone: "important", enabled: false },
    ]);
    expect(rules.map((r) => [r.id, r.daysBefore, r.tone, r.enabled])).toEqual([
      ["j12", 12, "information", true],
      ["j7", 7, "important", false],
      ["j2", 2, "dernier", true],
    ]);
  });

  it("rejette les délais identiques ou non entiers", () => {
    expect(() => normalizePreavisRules([
      { daysBefore: 5, tone: "information", enabled: true },
      { daysBefore: 5, tone: "dernier", enabled: false },
    ])).toThrow(/uniques/);
    expect(() => normalizePreavisRules([
      { daysBefore: 1.5, tone: "information", enabled: true },
    ])).toThrow(/entier/);
    expect(() => normalizePreavisRules([
      { daysBefore: 0, tone: "dernier", enabled: true },
    ])).toThrow(/entier/);
  });

  it("ne fait pas confiance aux valeurs arbitraires envoyées par le navigateur", () => {
    expect(() => normalizePreavisRules([
      { daysBefore: 5, tone: "menace", enabled: true },
    ])).toThrow(/Niveau/);
    expect(() => normalizePreavisRules([
      { daysBefore: 5, tone: "information", enabled: "yes" },
    ])).toThrow(/activation/);
    expect(() => normalizePreavisRules(new Array(21).fill({
      daysBefore: 5, tone: "information", enabled: true,
    }))).toThrow(/maximum/);
  });

  it("analyse les règles JSON et refuse les configurations invalides", () => {
    expect(parsePreavisRulesJson('[{"daysBefore":3,"tone":"courtois","enabled":true}]')[0].id).toBe("j3");
    expect(() => parsePreavisRulesJson("n'est pas du JSON")).toThrow(/JSON/);
  });

  it("retourne de nouvelles instances des règles par défaut", () => {
    const a = defaultPreavisRules();
    const b = defaultPreavisRules();
    a[0].daysBefore = 99;
    expect(b[0].daysBefore).toBe(15);
  });
});
