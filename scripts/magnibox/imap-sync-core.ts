export type MagniboxSyncEventType =
  | "message.created"
  | "message.updated"
  | "message.flags_changed"
  | "message.moved"
  | "message.deleted"
  | "message.label_added"
  | "message.label_removed";

export type MagniboxSyncOutboxEvent = {
  id: string;
  organization_id: string;
  aggregate_type: "internal_message" | "external_message";
  aggregate_id: string;
  event_type: MagniboxSyncEventType;
  payload: Record<string, unknown>;
  attempts: number;
  lease_token: string;
};

export type MagniboxSyncFailure = {
  retryable: boolean;
  message: string;
};

export interface MagniboxSyncOutboxRepository {
  claim(input: {
    workerId: string;
    limit: number;
    leaseSeconds: number;
  }): Promise<MagniboxSyncOutboxEvent[]>;
  complete(input: { eventId: string; leaseToken: string }): Promise<boolean>;
  fail(input: {
    eventId: string;
    leaseToken: string;
    error: string;
    retryable: boolean;
    retryAfterSeconds: number;
    maxAttempts: number;
  }): Promise<"pending" | "dead" | null>;
}

export interface MagniboxImapSyncAdapter {
  /**
   * Must be idempotent by event.id and reconcile against the canonical source
   * row + current mapping. It must never write Maildir files behind Dovecot.
   */
  apply(event: MagniboxSyncOutboxEvent): Promise<void>;
}

export class MagniboxSyncError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable = true) {
    super(message);
    this.name = "MagniboxSyncError";
    this.retryable = retryable;
  }
}

export type MagniboxSyncWorkerOptions = {
  workerId: string;
  batchSize?: number;
  leaseSeconds?: number;
  maxAttempts?: number;
  baseRetrySeconds?: number;
  maxRetrySeconds?: number;
  random?: () => number;
};

export type MagniboxSyncBatchResult = {
  claimed: number;
  delivered: number;
  retried: number;
  dead: number;
  leaseLost: number;
};

function boundedInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(Math.trunc(value), max));
}

export function magniboxRetryDelaySeconds(
  attempts: number,
  baseSeconds = 5,
  maxSeconds = 3600,
  random: () => number = Math.random,
): number {
  const base = boundedInteger(baseSeconds, 1, 3600);
  const ceiling = boundedInteger(maxSeconds, base, 86400);
  const exponent = Math.min(20, Math.max(0, boundedInteger(attempts, 1, 50) - 1));
  const cap = Math.min(ceiling, base * 2 ** exponent);
  const sample = Math.max(0, Math.min(0.999999999, random()));
  return Math.max(1, Math.floor(sample * cap) + 1);
}

function errorDetails(error: unknown): MagniboxSyncFailure {
  if (error instanceof MagniboxSyncError) {
    return { retryable: error.retryable, message: error.message };
  }
  if (error instanceof Error) {
    // Unknown exceptions are retried conservatively; a permanent failure
    // must be explicitly classified by the adapter.
    return { retryable: true, message: error.message };
  }
  return { retryable: true, message: String(error) };
}

/**
 * Process one claimed batch. Claiming increments attempts and creates a
 * fencing token. A worker that loses its lease cannot acknowledge a newer
 * worker's claim. A successful IMAP operation followed by a lost ACK is safe
 * only because adapter.apply is required to be idempotent.
 */
export async function runMagniboxSyncBatch(
  repository: MagniboxSyncOutboxRepository,
  adapter: MagniboxImapSyncAdapter,
  options: MagniboxSyncWorkerOptions,
): Promise<MagniboxSyncBatchResult> {
  if (!options.workerId?.trim()) throw new Error("A worker ID is required");

  const batchSize = boundedInteger(options.batchSize ?? 20, 1, 100);
  const leaseSeconds = boundedInteger(options.leaseSeconds ?? 120, 15, 900);
  const maxAttempts = boundedInteger(options.maxAttempts ?? 12, 1, 50);
  const baseRetrySeconds = boundedInteger(options.baseRetrySeconds ?? 5, 1, 3600);
  const maxRetrySeconds = boundedInteger(options.maxRetrySeconds ?? 3600, baseRetrySeconds, 86400);
  const random = options.random ?? Math.random;

  const events = await repository.claim({
    workerId: options.workerId,
    limit: batchSize,
    leaseSeconds,
  });

  const result: MagniboxSyncBatchResult = {
    claimed: events.length,
    delivered: 0,
    retried: 0,
    dead: 0,
    leaseLost: 0,
  };

  for (const event of events) {
    try {
      await adapter.apply(event);
      const acknowledged = await repository.complete({
        eventId: event.id,
        leaseToken: event.lease_token,
      });
      if (acknowledged) result.delivered += 1;
      else result.leaseLost += 1;
    } catch (error) {
      const failure = errorDetails(error);
      const retryAfterSeconds = magniboxRetryDelaySeconds(
        event.attempts,
        baseRetrySeconds,
        maxRetrySeconds,
        random,
      );
      const state = await repository.fail({
        eventId: event.id,
        leaseToken: event.lease_token,
        error: failure.message.slice(0, 2000),
        retryable: failure.retryable,
        retryAfterSeconds,
        maxAttempts,
      });
      if (state === "pending") result.retried += 1;
      else if (state === "dead") result.dead += 1;
      else result.leaseLost += 1;
    }
  }

  return result;
}
