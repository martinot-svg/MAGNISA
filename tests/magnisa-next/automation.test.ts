import { describe, expect, it } from "vitest";
import {
  automationIdempotencyKey,
  canRunAutomationRule,
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

  it("autorise uniquement une règle active du tenant et de l'événement", () => {
    expect(canRunAutomationRule(rule, "org-a", "invoice.overdue")).toBe(true);
    expect(canRunAutomationRule(rule, "org-b", "invoice.overdue")).toBe(false);
    expect(canRunAutomationRule(rule, "org-a", "payment.received")).toBe(false);
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
});
