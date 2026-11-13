import { describe, expect, it } from "vitest";
import { DEFAULT_PREAVIS_RULES, planBillingPreavis, renderBillingPreavis, parsePreavisOffsets, validatedPreavisRules } from "./preavis";

describe("MGMail — préavis de facturation", () => {
  it("calcule les délais par défaut en jours civils", () => {
    const events = planBillingPreavis({
      billingDate: "2026-11-28",
      contractStatus: "active",
      rules: DEFAULT_PREAVIS_RULES,
      asOfDate: "2026-11-01",
    });
    expect(events.map((event) => [event.daysBefore, event.scheduledDate])).toEqual([
      [15, "2026-11-13"],
      [10, "2026-11-18"],
      [5, "2026-11-23"],
      [1, "2026-11-27"],
    ]);
  });

  it("respecte des délais libres et ignore les échéances déjà passées", () => {
    const events = planBillingPreavis({
      billingDate: "2026-11-28",
      contractStatus: "active",
      asOfDate: "2026-11-20",
      rules: [
        { id: "j12", daysBefore: 12, tone: "information", enabled: true },
        { id: "j6", daysBefore: 6, tone: "important", enabled: true },
        { id: "j2", daysBefore: 2, tone: "dernier", enabled: true },
        { id: "disabled", daysBefore: 1, tone: "dernier", enabled: false },
      ],
    });
    expect(events.map((event) => event.scheduledDate)).toEqual(["2026-11-22", "2026-11-26"]);
  });

  it("calcule correctement les changements de mois et les années bissextiles", () => {
    const events = planBillingPreavis({
      billingDate: "2028-03-01",
      contractStatus: "active",
      rules: [{ id: "j1", daysBefore: 1, tone: "dernier", enabled: true }],
    });
    expect(events[0].scheduledDate).toBe("2028-02-29");
  });

  it.each(["suspended", "cancelled", "ended"])(
    "n'envoie aucun préavis pour un contrat %s",
    (contractStatus) => {
      expect(planBillingPreavis({
        billingDate: "2026-11-28",
        contractStatus,
        rules: DEFAULT_PREAVIS_RULES,
      })).toEqual([]);
    },
  );

  it("ne programme rien lorsque la facture est déjà émise", () => {
    expect(planBillingPreavis({
      billingDate: "2026-11-28",
      contractStatus: "active",
      alreadyIssued: true,
      rules: DEFAULT_PREAVIS_RULES,
    })).toEqual([]);
  });

  it("rejette les doublons et délais non valides", () => {
    expect(() => planBillingPreavis({
      billingDate: "2026-11-28",
      contractStatus: "active",
      rules: [
        { id: "a", daysBefore: 5, tone: "important", enabled: true },
        { id: "b", daysBefore: 5, tone: "dernier", enabled: true },
      ],
    })).toThrow(/unique/);
    expect(() => planBillingPreavis({
      billingDate: "2026-11-28",
      contractStatus: "active",
      rules: [{ id: "a", daysBefore: 0, tone: "dernier", enabled: true }],
    })).toThrow(/délai/);
    expect(() => planBillingPreavis({
      billingDate: "2026-02-30",
      contractStatus: "active",
      rules: DEFAULT_PREAVIS_RULES,
    })).toThrow(/Date/);
  });

  it("accepte des délais libres avec niveaux d'urgence cohérents", () => {
    const rules = parsePreavisOffsets("30, 12, 7, 2, 1");
    expect(rules.map((x) => x.daysBefore)).toEqual([30, 12, 7, 2, 1]);
    expect(rules.map((x) => x.tone)).toEqual([
      "information", "information", "courtois", "important", "dernier",
    ]);
    expect(validatedPreavisRules(rules)).toEqual(rules);
  });

  it("rejette les configurations de préavis malformées", () => {
    expect(() => parsePreavisOffsets("7,7")).toThrow(/uniques/);
    expect(() => parsePreavisOffsets("0,3")).toThrow(/compris/);
    expect(() => parsePreavisOffsets("2.5")).toThrow(/entiers/);
    expect(validatedPreavisRules([{ id: "j3", daysBefore: -3, enabled: true, tone: "dernier" }])).toBeNull();
    expect(validatedPreavisRules("15,10,5")).toBeNull();
  });

  it("rédige un préavis sans prétendre que la facture est émise ou impayée", () => {
    const mail = renderBillingPreavis({
      companyName: "Mitalia",
      customerName: "Client",
      serviceName: "Abonnement mensuel",
      billingDate: "2026-11-28",
      tone: "dernier",
      estimatedAmount: "150 000 Ar",
    });
    expect(mail.subject).toContain("28 novembre 2026");
    expect(mail.body).toContain("est prévue");
    expect(mail.body).toContain("150 000 Ar");
    expect(mail.body).not.toMatch(/impayée|en retard/i);
  });
});
