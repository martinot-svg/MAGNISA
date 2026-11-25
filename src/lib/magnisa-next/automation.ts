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

export type AutomationJobStatus =
  | "queued"
  | "running"
  | "retry"
  | "succeeded"
  | "dead";

export type AutomationJobState = {
  status: AutomationJobStatus;
  attempts: number;
  maxAttempts: number;
  nextRunAt: string | null;
  lastError: string | null;
};

export type AutomationAttemptResult =
  | { ok: true }
  | { ok: false; error: string };

function parseStrictInstant(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    return null;
  }

  const date = value.slice(0, 10);
  const calendarDate = new Date(date + "T00:00:00.000Z");
  if (!Number.isFinite(calendarDate.getTime()) ||
      calendarDate.toISOString().slice(0, 10) !== date) {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

/**
 * Clé déterministe pour protéger les exécutions répétées.
 * La base doit imposer une contrainte UNIQUE sur cette clé dans la table
 * d'exécutions. La clé ne remplace pas la validation serveur.
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

/** Indique si un job en attente ou en reprise est arrivé à échéance. */
export function isAutomationJobDue(
  job: AutomationJobState,
  now: string,
): boolean {
  const nowMs = parseStrictInstant(now);
  if (nowMs === null) throw new Error("Date de référence invalide.");
  if (job.status !== "queued" && job.status !== "retry") return false;
  if (job.nextRunAt === null) return job.status === "queued";
  const dueMs = parseStrictInstant(job.nextRunAt);
  if (dueMs === null) throw new Error("Date de reprise invalide.");
  return dueMs <= nowMs;
}

/**
 * Enregistre le résultat d'une tentative sans I/O.
 * L'orchestrateur doit persister atomiquement l'état et verrouiller le job
 * avant d'exécuter l'action externe (transaction/claim côté base).
 */
export function recordAutomationAttempt(
  job: AutomationJobState,
  result: AutomationAttemptResult,
  now: string,
  baseDelayMs = 30_000,
  maxDelayMs = 6 * 60 * 60 * 1000,
): AutomationJobState {
  const nowMs = parseStrictInstant(now);
  if (nowMs === null) throw new Error("Date de tentative invalide.");
  if (!Number.isInteger(job.attempts) || job.attempts < 0) {
    throw new Error("Compteur de tentatives invalide.");
  }
  if (!Number.isInteger(job.maxAttempts) || job.maxAttempts < 1) {
    throw new Error("Nombre maximal de tentatives invalide.");
  }
  if (!Number.isFinite(baseDelayMs) || baseDelayMs < 1 ||
      !Number.isFinite(maxDelayMs) || maxDelayMs < baseDelayMs) {
    throw new Error("Paramètres de reprise invalides.");
  }
  if (job.status === "succeeded" || job.status === "dead") {
    throw new Error("Un job terminal ne peut plus être exécuté.");
  }

  const attempts = job.attempts + 1;
  if (result.ok === false) {
    const lastError = result.error.trim().slice(0, 2000) || "Échec non détaillé.";
    if (attempts >= job.maxAttempts) {
      return { ...job, status: "dead", attempts, nextRunAt: null, lastError };
    }

    const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** Math.min(attempts - 1, 30));
    return {
      ...job,
      status: "retry",
      attempts,
      nextRunAt: new Date(nowMs + delay).toISOString(),
      lastError,
    };
  }

  return {
    ...job,
    status: "succeeded",
    attempts,
    nextRunAt: null,
    lastError: null,
  };
}
