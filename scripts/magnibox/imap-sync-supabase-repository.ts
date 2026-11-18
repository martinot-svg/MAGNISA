import {
  MagniboxSyncError,
  type MagniboxSyncOutboxEvent,
  type MagniboxSyncOutboxRepository,
} from "./imap-sync-core";

type RpcError = { message?: string } | null;
type RpcResult = { data: unknown; error: RpcError };

export interface MagniboxSupabaseRpcClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<RpcResult>;
}

const EVENT_TYPES = new Set([
  "message.created",
  "message.updated",
  "message.flags_changed",
  "message.moved",
  "message.deleted",
  "message.label_added",
  "message.label_removed",
]);

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MagniboxSyncError(`Invalid ${label}: expected an object`, false);
  }
  return value as Record<string, unknown>;
}

function requiredString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new MagniboxSyncError(`Invalid outbox event field: ${key}`, false);
  }
  return value;
}

function mapEvent(value: unknown): MagniboxSyncOutboxEvent {
  const row = asRecord(value, "outbox event");
  const aggregateType = requiredString(row, "aggregate_type");
  const eventType = requiredString(row, "event_type");
  const attempts = row.attempts;
  if (aggregateType !== "internal_message" && aggregateType !== "external_message") {
    throw new MagniboxSyncError("Invalid outbox aggregate_type", false);
  }
  if (!EVENT_TYPES.has(eventType)) {
    throw new MagniboxSyncError("Invalid outbox event_type", false);
  }
  if (!Number.isInteger(attempts) || (attempts as number) < 1) {
    throw new MagniboxSyncError("Invalid outbox attempts", false);
  }
  const payload = row.payload === undefined ? {} : asRecord(row.payload, "outbox payload");

  return {
    id: requiredString(row, "id"),
    organization_id: requiredString(row, "organization_id"),
    aggregate_type: aggregateType,
    aggregate_id: requiredString(row, "aggregate_id"),
    event_type: eventType as MagniboxSyncOutboxEvent["event_type"],
    payload,
    attempts: attempts as number,
    lease_token: requiredString(row, "lease_token"),
  };
}

async function callRpc(
  client: MagniboxSupabaseRpcClient,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const result = await client.rpc(name, args);
  if (result.error) {
    // Database/network failures are retryable by default. Schema or contract
    // failures are surfaced by strict response validation below.
    throw new Error(result.error.message || `Supabase RPC ${name} failed`);
  }
  return result.data;
}

/** Supabase RPC binding for the lease-fenced MAGNIBOX sync outbox. */
export function createMagniboxSupabaseOutboxRepository(
  client: MagniboxSupabaseRpcClient,
): MagniboxSyncOutboxRepository {
  return {
    async claim({ workerId, limit, leaseSeconds }) {
      const data = await callRpc(client, "magnibox_claim_sync_events", {
        p_worker_id: workerId,
        p_limit: limit,
        p_lease_seconds: leaseSeconds,
      });
      if (!Array.isArray(data)) {
        throw new MagniboxSyncError("Supabase claim RPC returned a non-array result", false);
      }
      return data.map(mapEvent);
    },

    async complete({ eventId, leaseToken }) {
      const data = await callRpc(client, "magnibox_complete_sync_event", {
        p_event_id: eventId,
        p_lease_token: leaseToken,
      });
      if (typeof data !== "boolean") {
        throw new MagniboxSyncError("Supabase complete RPC returned a non-boolean result", false);
      }
      return data;
    },

    async fail({ eventId, leaseToken, error, retryable, retryAfterSeconds, maxAttempts }) {
      const data = await callRpc(client, "magnibox_fail_sync_event", {
        p_event_id: eventId,
        p_lease_token: leaseToken,
        p_error: error,
        p_retryable: retryable,
        p_retry_after_seconds: retryAfterSeconds,
        p_max_attempts: maxAttempts,
      });
      if (data === null) return null;
      if (data === "pending" || data === "dead") return data;
      throw new MagniboxSyncError("Supabase fail RPC returned an unknown state", false);
    },
  };
}
