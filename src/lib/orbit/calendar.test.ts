import { describe, expect, it } from "vitest";
import { orbitMonth, orbitDateLabel } from "./calendar";

describe("Magnisa Orbit — calendrier compatible", () => {
  it("commence le lundi et traverse novembre 2026", () => {
    const month = orbitMonth("2026-11");
    expect(month.offset).toBe(6);
    expect(month.days).toHaveLength(30);
    expect(month.first).toBe("2026-11-01");
    expect(month.previous).toBe("2026-10");
    expect(month.next).toBe("2026-12");
  });
  it("gère les années bissextiles", () => {
    expect(orbitMonth("2028-02").days).toHaveLength(29);
    expect(orbitMonth("2027-02").days).toHaveLength(28);
  });
  it("ignore les mois de recherche invalides", () => {
    expect(orbitMonth("2026-13", new Date("2026-11-14T00:00:00Z")).month).toBe("2026-11");
  });
  it("formate une date sans décalage du fuseau", () => {
    expect(orbitDateLabel("2026-11-14")).toContain("novembre");
    expect(orbitDateLabel("2026-02-30")).toBe("2026-02-30");
  });
});
