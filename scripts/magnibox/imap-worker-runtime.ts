import type { MagniboxImapSyncAdapter, MagniboxSyncOutboxRepository } from "./imap-sync-core";

export type MagniboxImapWorkerConfig = {
  workerId: string;
  pollIntervalMs: number;
  batchSize: number;
  leaseSeconds: number;
  maxAttempts: number;
  baseRetrySeconds: number;
  maxRetrySeconds: number;
};

function integerEnv(env: Record<string, string | undefined>, key: string, fallback: number, min: number, max: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`Invalid ${key}: expected an integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`Invalid ${key}: value outside allowed range`);
  }
  return value;
}

export function readMagniboxImapWorkerConfig(env: Record<string, string | undefined>): MagniboxImapWorkerConfig {
  const workerId = env.MAGNIBOX_IMAP_WORKER_ID?.trim() || `magnibox-imap-${env.HOSTNAME || "local"}`;
  if (workerId.length > 120 || /[\r\n\x00-\x1f]/.test(workerId)) throw new Error("Invalid MAGNIBOX_IMAP_WORKER_ID");
  const baseRetrySeconds = integerEnv(env, "MAGNIBOX_IMAP_BASE_RETRY_SECONDS", 5, 1, 3600);
  const maxRetrySeconds = integerEnv(env, "MAGNIBOX_IMAP_MAX_RETRY_SECONDS", 3600, baseRetrySeconds, 86400);
  return {
    workerId,
    pollIntervalMs: integerEnv(env, "MAGNIBOX_IMAP_POLL_INTERVAL_MS", 5000, 250, 300000),
    batchSize: integerEnv(env, "MAGNIBOX_IMAP_BATCH_SIZE", 10, 1, 100),
    leaseSeconds: integerEnv(env, "MAGNIBOX_IMAP_LEASE_SECONDS", 120, 15, 900),
    maxAttempts: integerEnv(env, "MAGNIBOX_IMAP_MAX_ATTEMPTS", 12, 1, 50),
    baseRetrySeconds,
    maxRetrySeconds,
  };
}

export type MagniboxWorkerLogger = {
  info(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
};

export type MagniboxWorkerDependencies = {
  repository: MagniboxSyncOutboxRepository;
  adapter: MagniboxImapSyncAdapter;
  config: MagniboxImapWorkerConfig;
  logger: MagniboxWorkerLogger;
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
};

function defaultSleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener("abort", finish, { once: true });
  });
}

/** Polls the transactional outbox until shutdown; every batch is lease-fenced. */
export async function runMagniboxImapWorker(dependencies: MagniboxWorkerDependencies, signal: AbortSignal): Promise<void> {
  const { repository, adapter, config, logger } = dependencies;
  const sleep = dependencies.sleep ?? defaultSleep;
  while (!signal.aborted) {
    try {
      const { runMagniboxSyncBatch } = await import("./imap-sync-core");
      const result = await runMagniboxSyncBatch(repository, adapter, {
        workerId: config.workerId,
        batchSize: config.batchSize,
        leaseSeconds: config.leaseSeconds,
        maxAttempts: config.maxAttempts,
        baseRetrySeconds: config.baseRetrySeconds,
        maxRetrySeconds: config.maxRetrySeconds,
      });
      if (result.claimed > 0) logger.info({ ...result, workerId: config.workerId }, "MAGNIBOX IMAP batch completed");
      if (result.claimed === 0) await sleep(config.pollIntervalMs, signal);
    } catch {
      // Do not log provider errors, message content, credentials or raw SQL details.
      logger.error({ workerId: config.workerId }, "MAGNIBOX IMAP worker cycle failed; will retry");
      await sleep(config.pollIntervalMs, signal);
    }
  }
}
