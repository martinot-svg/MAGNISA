import { describe, expect, it, vi } from "vitest";
import {
  MagniboxSyncError,
  magniboxRetryDelaySeconds,
  runMagniboxSyncBatch,
  type MagniboxImapSyncAdapter,
  type MagniboxSyncOutboxEvent,
  type MagniboxSyncOutboxRepository,
} from "./imap-sync-core";

function event(overrides: Partial<MagniboxSyncOutboxEvent> = {}): MagniboxSyncOutboxEvent {
  return {
    id: "event-1",
    organization_id: "org-1",
    aggregate_type: "internal_message",
    aggregate_id: "message-1",
    event_type: "message.created",
    payload: { message_id: "message-1" },
    attempts: 1,
    lease_token: "lease-1",
    ...overrides,
  };
}

function repository(events: MagniboxSyncOutboxEvent[] = []): MagniboxSyncOutboxRepository {
  return {
    claim: vi.fn(async () => events),
    complete: vi.fn(async () => true),
    fail: vi.fn(async () => "pending" as const),
  } satisfies MagniboxSyncOutboxRepository;
}

describe("magniboxRetryDelaySeconds", () => {
  it("uses capped exponential backoff with full jitter", () => {
    expect(magniboxRetryDelaySeconds(1, 10, 100, () => 0)).toBe(1);
    expect(magniboxRetryDelaySeconds(1, 10, 100, () => 0.5)).toBe(6);
    expect(magniboxRetryDelaySeconds(2, 10, 100, () => 0.99)).toBe(20);
    expect(magniboxRetryDelaySeconds(10, 10, 100, () => 0.99)).toBe(100);
  });

  it("bounds invalid inputs", () => {
    expect(magniboxRetryDelaySeconds(-1, 0, 0, () => 1)).toBe(1);
    expect(magniboxRetryDelaySeconds(50, 1, 5, () => 0.99)).toBe(5);
  });
});

describe("runMagniboxSyncBatch", () => {
  it("claims, applies and acknowledges each event", async () => {
    const repo = repository([event(), event({ id: "event-2", lease_token: "lease-2" })]);
    const adapter: MagniboxImapSyncAdapter = { apply: vi.fn(async () => undefined) };

    const result = await runMagniboxSyncBatch(repo, adapter, {
      workerId: "worker-a",
      random: () => 0.5,
    });

    expect(repo.claim).toHaveBeenCalledWith({
      workerId: "worker-a",
      limit: 20,
      leaseSeconds: 120,
    });
    expect(adapter.apply).toHaveBeenCalledTimes(2);
    expect(repo.complete).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      claimed: 2,
      delivered: 2,
      retried: 0,
      dead: 0,
      leaseLost: 0,
    });
  });

  it("schedules retryable failures with backoff", async () => {
    const repo = repository([event({ attempts: 3 })]);
    const adapter: MagniboxImapSyncAdapter = {
      apply: vi.fn(async () => { throw new Error("temporary IMAP timeout"); }),
    };

    const result = await runMagniboxSyncBatch(repo, adapter, {
      workerId: "worker-a",
      baseRetrySeconds: 10,
      random: () => 0.5,
    });

    expect(repo.fail).toHaveBeenCalledWith(expect.objectContaining({
      eventId: "event-1",
      leaseToken: "lease-1",
      retryable: true,
      retryAfterSeconds: 21,
      maxAttempts: 12,
    }));
    expect(result.retried).toBe(1);
  });

  it("moves explicitly permanent failures to the dead-letter state", async () => {
    const repo = repository([event()]);
    repo.fail = vi.fn(async () => "dead" as const);
    const adapter: MagniboxImapSyncAdapter = {
      apply: vi.fn(async () => { throw new MagniboxSyncError("invalid mailbox mapping", false); }),
    };

    const result = await runMagniboxSyncBatch(repo, adapter, { workerId: "worker-a" });

    expect(repo.fail).toHaveBeenCalledWith(expect.objectContaining({
      retryable: false,
      error: "invalid mailbox mapping",
    }));
    expect(result.dead).toBe(1);
  });

  it("does not acknowledge work after the lease has been lost", async () => {
    const repo = repository([event()]);
    repo.complete = vi.fn(async () => false);
    const adapter: MagniboxImapSyncAdapter = { apply: vi.fn(async () => undefined) };

    const result = await runMagniboxSyncBatch(repo, adapter, { workerId: "worker-a" });

    expect(result.delivered).toBe(0);
    expect(result.leaseLost).toBe(1);
  });

  it("requires a worker identity and never claims when it is missing", async () => {
    const repo = repository();
    const adapter: MagniboxImapSyncAdapter = { apply: vi.fn(async () => undefined) };

    await expect(runMagniboxSyncBatch(repo, adapter, { workerId: " " })).rejects.toThrow("worker ID");
    expect(repo.claim).not.toHaveBeenCalled();
  });
});
