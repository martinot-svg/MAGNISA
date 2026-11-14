import { describe, expect, it } from "vitest";
import {
  dueBillingPreavis,
  madagascarCivilDate,
  parseMadagascarScheduledTime,
  validateScheduledContent,
} from "./scheduled";
import { scheduledInternetEnabled } from "./scheduled-worker";
import { DEFAULT_PREAVIS_RULES } from "./preavis";

describe("MGMail — e-mails programmés", () => {
  const now = new Date("2026-11-14T04:00:00.000Z");

  it("convertit correctement une heure malgache en UTC", () => {
    expect(parseMadagascarScheduledTime("2026-11-14T08:30", now))
      .toBe("2026-11-14T05:30:00.000Z");
  });

  it("rejette les dates invalides, anciennes ou déraisonnablement éloignées", () => {
    expect(() => parseMadagascarScheduledTime("2026-11-31T09:00", now))
      .toThrow(/invalides/);
    expect(() => parseMadagascarScheduledTime("2026-11-14T07:03", now))
      .toThrow(/5 minutes/);
    expect(() => parseMadagascarScheduledTime("2028-01-01T09:00", now))
      .toThrow(/365 jours/);
    expect(() => parseMadagascarScheduledTime("pas une date", now)).toThrow();
  });

  it("valide les destinataires et le contenu avant la mise en file", () => {
    expect(validateScheduledContent({
      to: "client@gmail.com, prestataire@outlook.com",
      subject: " Préavis d'abonnement ",
      body: " Bonjour, ",
      when: "2026-11-14T08:30",
    }, now)).toMatchObject({
      to: ["client@gmail.com", "prestataire@outlook.com"],
      subject: "Préavis d'abonnement",
      body: "Bonjour,",
    });
  });

  it("interdit toute émission par défaut, même si une clé fournisseur est présente", () => {
    expect(scheduledInternetEnabled({ MGMAIL_RESEND_API_KEY: "test" })).toBe(false);
    expect(scheduledInternetEnabled({ MGMAIL_AUTO_SEND_ENABLED: "true" })).toBe(false);
    expect(scheduledInternetEnabled({
      MGMAIL_AUTO_SEND_ENABLED: "true", MGMAIL_RESEND_API_KEY: "test",
    })).toBe(true);
  });

  it("utilise la date civile d'Antananarivo, pas celle du serveur UTC", () => {
    expect(madagascarCivilDate(new Date("2026-11-13T22:30:00.000Z")))
      .toBe("2026-11-14");
  });
});

describe("MGMail — préavis de facturation sans doublon", () => {
  const input = {
    today: "2026-11-15",
    billingDate: "2026-11-30",
    contractStatus: "active",
    rules: DEFAULT_PREAVIS_RULES,
    companyName: "Mitalia",
    customerName: "Client",
    serviceName: "Abonnement mensuel",
    recipient: "client@proton.me",
  };

  it("produit exclusivement le message J−15 avec une formulation informative", () => {
    const notices = dueBillingPreavis(input);
    expect(notices).toHaveLength(1);
    expect(notices[0].daysBefore).toBe(15);
    expect(notices[0].recipient).toBe("client@proton.me");
    expect(notices[0].body).toContain("Nous vous informons");
    expect(notices[0].body).toContain("30 novembre 2026");
  });

  it("adapte l'urgence à J−10, J−5 et J−1", () => {
    const important = dueBillingPreavis({ ...input, today: "2026-11-25" });
    const dernier = dueBillingPreavis({ ...input, today: "2026-11-29" });
    expect(important).toHaveLength(1);
    expect(important[0].daysBefore).toBe(5);
    expect(important[0].body).toContain("attirons votre attention");
    expect(dernier[0].daysBefore).toBe(1);
    expect(dernier[0].tone).toBe("dernier");
    expect(dernier[0].subject).toContain("Dernier rappel");
    expect(dernier[0].body).toContain("Dernier rappel avant facturation");
  });

  it("respecte le délai arbitraire demandé par l'administrateur", () => {
    const custom = dueBillingPreavis({
      ...input, today: "2026-11-23",
      rules: [{ id: "j7", daysBefore: 7, tone: "courtois" as const, enabled: true }],
    });
    expect(custom.map((n) => n.daysBefore)).toEqual([7]);
  });

  it("ignore les dates passées, les prestations suspendues et les factures déjà émises", () => {
    expect(dueBillingPreavis({ ...input, today: "2026-11-16" })).toEqual([]);
    expect(dueBillingPreavis({ ...input, contractStatus: "suspended" })).toEqual([]);
    expect(dueBillingPreavis({ ...input, alreadyIssued: true })).toEqual([]);
  });

  it("refuse toute adresse de client invalide", () => {
    expect(() => dueBillingPreavis({ ...input, recipient: "adresse-invalide" }))
      .toThrow(/invalide/);
  });
});
