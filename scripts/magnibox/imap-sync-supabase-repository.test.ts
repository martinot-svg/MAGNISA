import { describe, expect, it, vi } from "vitest";
import { MagniboxSyncError } from "./imap-sync-core";
import {
  createMagniboxSupabaseOutboxRepository,
  type MagniboxSupabaseRpcClient,
} from "./imap-sync-supabase-repository";

function rpcClient(responses: unknown[]): MagniboxSupabaseRpcClient & { rpc: ReturnType<typeof vi.fn> } {
  return {
    rpc: vi.fn(async () => ({ data: responses.shift(), error: null })),
  };
}

const claimedEvent = {
  id: "event-1",
  organization_id: "org-1",
  aggregate_type: "internal_message",
  aggregate_id: "message-1",
  event_type: "message.created",
  payload: { message_id: "message-1" },
  attempts: 2,
  lease_token: "lease-1",
};

describe("createMagniboxSupabaseOutboxRepository", () => {
  it("maps a claimed Supabase row and sends bounded claim arguments", async () => {
    const client = rpcClient([[claimedEvent]]);
    const repository = createMagniboxSupabaseOutboxRepository(client);

    await expect(repository.claim({ workerId: "worker-a", limit: 15, leaseSeconds: 90 }))
      .resolves.toEqual([claimedEvent]);
    expect(client.rpc).toHaveBeenCalledWith("magnibox_claim_sync_events", {
      p_worker_id: "worker-a",
      p_limit: 15,
      p_lease_seconds: 90,
    });
  });

  it("uses the lease token when acknowledging an event", async () => {
    const client = rpcClient([true]);
    const repository = createMagniboxSupabaseOutboxRepository(client);

    await expect(repository.complete({ eventId: "event-1", leaseToken: "lease-1" })).resolves.toBe(true);
    expect(client.rpc).toHaveBeenCalledWith("magnibox_complete_sync_event", {
      p_event_id: "event-1",
      p_lease_token: "lease-1",
    });
  });

  it("passes retry and dead-letter policy to the failure RPC", async () => {
    const client = rpcClient(["pending"]);
    const repository = createMagniboxSupabaseOutboxRepository(client);

    await expect(repository.fail({
      eventId: "event-1",
      leaseToken: "lease-1",
      error: "temporary IMAP timeout",
      retryable: true,
      retryAfterSeconds: 30,
      maxAttempts: 8,
    })).resolves.toBe("pending");
    expect(client.rpc).toHaveBeenCalledWith("magnibox_fail_sync_event", {
      p_event_id: "event-1",
      p_lease_token: "lease-1",
      p_error: "temporary IMAP timeout",
      p_retryable: true,
      p_retry_after_seconds: 30,
      p_max_attempts: 8,
    });
  });

  it("returns null when the failure RPC reports a stale lease", async () => {
    const repository = createMagniboxSupabaseOutboxRepository(rpcClient([null]));
    await expect(repository.fail({
      eventId: "event-1",
      leaseToken: "expired-token",
      error: "stale",
      retryable: true,
      retryAfterSeconds: 10,
      maxAttempts: 5,
    })).resolves.toBeNull();
  });

  it("rejects malformed claimed rows as permanent contract errors", async () => {
    const repository = createMagniboxSupabaseOutboxRepository(rpcClient([[{
      ...claimedEvent,
      lease_token: null,
    }]]));

    await expect(repository.claim({ workerId: "worker-a", limit: 1, leaseSeconds: 60 }))
      .rejects.toBeInstanceOf(MagniboxSyncError);
  });

  it("surfaces Supabase RPC errors for the worker retry policy", async () => {
    const client: MagniboxSupabaseRpcClient = {
      rpc: vi.fn(async () => ({ data: null, error: { message: "connection reset" } })),
    };
    const repository = createMagniboxSupabaseOutboxRepository(client);

    await expect(repository.claim({ workerId: "worker-a", limit: 1, leaseSeconds: 60 }))
      .rejects.toThrow("connection reset");
  });

  it("rejects unexpected scalar RPC responses", async () => {
    const repository = createMagniboxSupabaseOutboxRepository(rpcClient(["yes"]));
    await expect(repository.complete({ eventId: "event-1", leaseToken: "lease-1" }))
      .rejects.toThrow("non-boolean");
  });
});
