export type AutomationEvent =
  | "quote.accepted"
  | "invoice.issued"
  | "invoice.overdue"
  | "payment.received"
  | "stock.threshold_reached"
  | "recurring_contract.due";

export type AutomationAction =
  | "notification.create"
  | "email.send"
  | "task.create";

export type AutomationRule = {
  id: string;
  organizationId: string;
  event: AutomationEvent;
  action: AutomationAction;
  enabled: boolean;
  configuration: Record<string, unknown>;
};

export type AutomationExecution = {
  organizationId: string;
  ruleId: string;
  eventId: string;
  action: AutomationAction;
};

/**
 * Clé déterministe pour protéger les exécutions répétées.
 * La base doit imposer une contrainte UNIQUE sur cette clé dans la future
 * table d'exécutions. La clé ne remplace pas la validation serveur.
 */
export function automationIdempotencyKey(
  execution: AutomationExecution,
): string {
  const parts = [
    execution.organizationId,
    execution.ruleId,
    execution.eventId,
    execution.action,
  ];

  if (parts.some((part) => !part || part.trim() !== part)) {
    throw new Error("Les identifiants d'automatisation sont invalides.");
  }

  return parts.map(encodeURIComponent).join(":");
}

export function canRunAutomationRule(
  rule: AutomationRule,
  organizationId: string,
  event: AutomationEvent,
): boolean {
  return (
    rule.enabled &&
    rule.organizationId === organizationId &&
    rule.event === event
  );
}
