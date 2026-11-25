import { describe, expect, it } from "vitest";
import {
  automationIdempotencyKey,
  canRunAutomationRule,
  isAutomationJobDue,
  recordAutomationAttempt,
  type AutomationJobState,
  type AutomationRule,
} from "../../src/lib/magnisa-next/automation";

describe("automation", () => {
  const rule: AutomationRule = {
    id: "rule-1",
    organizationId: "org-a",
    event: "invoice.overdue",
    action: "notification.create",
    enabled: true,
    configuration: {},
  };

  const queued: AutomationJobState = {
    status: "queued",
    attempts: 0,
    maxAttempts: 3,
    nextRunAt: null,
    lastError: null,
  };

  it("autorise uniquement une règle active du tenant et de l'événement", () => {
    expect(canRunAutomationRule(rule, "org-a", "invoice.overdue")).toBe(true);
    expect(canRunAutomationRule(rule, "org-b", "invoice.overdue")).toBe(false);
    expect(canRunAutomationRule(rule, "org-a", "payment.received")).toBe(false);
    expect(canRunAutomationRule({ ...rule, enabled: false }, "org-a", "invoice.overdue")).toBe(false);
  });

  it("produit une clé d'idempotence déterministe", () => {
    const input = {
      organizationId: "org-a",
      ruleId: "rule-1",
      eventId: "event-99",
      action: "notification.create" as const,
    };
    expect(automationIdempotencyKey(input)).toBe(automationIdempotencyKey(input));
  });

  it("programme une reprise exponentielle plafonnée après un échec", () => {
    const first = recordAutomationAttempt(
      queued,
      { ok: false, error: "temporarily unavailable" },
      "2026-11-24T10:00:00.000Z",
      1000,
      2500,
    );
    expect(first).toMatchObject({ status: "retry", attempts: 1, lastError: "temporarily unavailable" });
    expect(first.nextRunAt).toBe("2026-11-24T10:00:01.000Z");

    const second = recordAutomationAttempt(
      first,
      { ok: false, error: "still unavailable" },
      "2026-11-24T10:00:01.000Z",
      1000,
      2500,
    );
    expect(second.nextRunAt).toBe("2026-11-24T10:00:03.000Z");
  });

  it("termine en dead-letter après le nombre maximal de tentatives", () => {
    const last = recordAutomationAttempt(
      { ...queued, attempts: 2, status: "retry" },
      { ok: false, error: "final failure" },
      "2026-11-24T10:00:00.000Z",
    );
    expect(last).toMatchObject({ status: "dead", attempts: 3, nextRunAt: null });
  });

  it("marque un succès comme terminal et efface l'erreur", () => {
    const success = recordAutomationAttempt(
      { ...queued, status: "running", attempts: 1, lastError: "previous" },
      { ok: true },
      "2026-11-24T10:00:00.000Z",
    );
    expect(success).toMatchObject({ status: "succeeded", attempts: 2, nextRunAt: null, lastError: null });
  });

  it("détermine si une reprise est due et rejette les dates invalides", () => {
    const retry = { ...queued, status: "retry" as const, nextRunAt: "2026-11-24T10:00:00.000Z" };
    expect(isAutomationJobDue(retry, "2026-11-24T09:59:59.000Z")).toBe(false);
    expect(isAutomationJobDue(retry, "2026-11-24T10:00:00.000Z")).toBe(true);
    expect(isAutomationJobDue({ ...retry, status: "succeeded" }, "2026-11-24T11:00:00.000Z")).toBe(false);
    expect(() => isAutomationJobDue(retry, "invalid")).toThrow();
    expect(() => isAutomationJobDue(retry, "November 24, 2026 10:00")).toThrow();
    expect(() => isAutomationJobDue(retry, "2026-02-30T10:00:00.000Z")).toThrow();
    expect(() => isAutomationJobDue(
      { ...retry, nextRunAt: "2026-02-30T10:00:00.000Z" },
      "2026-11-24T10:00:00.000Z",
    )).toThrow();
  });

  it("refuse les dates non strictes lors de l'enregistrement d'une tentative", () => {
    expect(() => recordAutomationAttempt(
      queued,
      { ok: true },
      "2026-11-24",
    )).toThrow();
    expect(() => recordAutomationAttempt(
      queued,
      { ok: true },
      "2026-02-30T10:00:00.000Z",
    )).toThrow();
  });

  it("refuse de réexécuter un job terminal", () => {
    expect(() => recordAutomationAttempt(
      { ...queued, status: "succeeded" },
      { ok: true },
      "2026-11-24T10:00:00.000Z",
    )).toThrow();
  });
});
