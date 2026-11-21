import { describe, expect, it, vi } from "vitest";
import {
  readMagniboxImapWorkerConfig,
  runMagniboxImapWorker,
} from "./imap-worker-runtime";
import type { MagniboxSyncOutboxRepository } from "./imap-sync-core";

describe("readMagniboxImapWorkerConfig", () => {
  it("uses safe defaults and a stable host-derived worker ID", () => {
    expect(readMagniboxImapWorkerConfig({ HOSTNAME: "worker-1" })).toEqual({
      workerId: "magnibox-imap-worker-1",
      pollIntervalMs: 5000,
      batchSize: 10,
      leaseSeconds: 120,
      maxAttempts: 12,
      baseRetrySeconds: 5,
      maxRetrySeconds: 3600,
    });
  });

  it("rejects out-of-range or non-integer settings", () => {
    expect(() => readMagniboxImapWorkerConfig({ MAGNIBOX_IMAP_BATCH_SIZE: "0" })).toThrow("outside allowed range");
    expect(() => readMagniboxImapWorkerConfig({ MAGNIBOX_IMAP_POLL_INTERVAL_MS: "1.5" })).toThrow("expected an integer");
    expect(() => readMagniboxImapWorkerConfig({
      MAGNIBOX_IMAP_BASE_RETRY_SECONDS: "60",
      MAGNIBOX_IMAP_MAX_RETRY_SECONDS: "10",
    })).toThrow("outside allowed range");
  });

  it("rejects unsafe worker identifiers", () => {
    expect(() => readMagniboxImapWorkerConfig({
      MAGNIBOX_IMAP_WORKER_ID: "worker\nforged",
    })).toThrow("Invalid MAGNIBOX_IMAP_WORKER_ID");
  });
});

describe("runMagniboxImapWorker", () => {
  it("polls the outbox and exits cleanly on abort", async () => {
    const controller = new AbortController();
    const repository: MagniboxSyncOutboxRepository = {
      claim: vi.fn(async () => []),
      complete: vi.fn(async () => true),
      fail: vi.fn(async () => "pending"),
    };
    const logger = { info: vi.fn(), error: vi.fn() };
    const config = readMagniboxImapWorkerConfig({ MAGNIBOX_IMAP_WORKER_ID: "test-worker" });
    const sleep = vi.fn(async () => controller.abort());

    await runMagniboxImapWorker({
      repository,
      adapter: { apply: vi.fn(async () => undefined) },
      config,
      logger,
      sleep,
    }, controller.signal);

    expect(repository.claim).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(config.pollIntervalMs, controller.signal);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("does not claim work after shutdown is requested", async () => {
    const controller = new AbortController();
    controller.abort();
    const repository: MagniboxSyncOutboxRepository = {
      claim: vi.fn(async () => []),
      complete: vi.fn(async () => true),
      fail: vi.fn(async () => "pending"),
    };

    await runMagniboxImapWorker({
      repository,
      adapter: { apply: vi.fn(async () => undefined) },
      config: readMagniboxImapWorkerConfig({}),
      logger: { info: vi.fn(), error: vi.fn() },
    }, controller.signal);

    expect(repository.claim).not.toHaveBeenCalled();
  });
});
