import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { pathToFileURL } from "node:url";
import { isAbsolute, relative, resolve } from "node:path";
import { createMagniboxSupabaseOutboxRepository } from "./imap-sync-supabase-repository";
import { readMagniboxImapWorkerConfig, runMagniboxImapWorker } from "./imap-worker-runtime";
import type { MagniboxImapSyncAdapter } from "./imap-sync-core";

type AdapterModule = {
  createMagniboxImapSyncAdapter(input: { supabase: SupabaseClient<any, "public", "public", any, any> }): MagniboxImapSyncAdapter | Promise<MagniboxImapSyncAdapter>;
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function main(): Promise<void> {
  const supabaseUrl = new URL(requiredEnv("MAGNIBOX_WORKER_SUPABASE_URL"));
  if (supabaseUrl.protocol !== "https:" && !["localhost", "127.0.0.1", "::1"].includes(supabaseUrl.hostname)) {
    throw new Error("Supabase worker endpoint must use HTTPS outside loopback");
  }
  const serviceRoleKey = requiredEnv("MAGNIBOX_WORKER_SERVICE_ROLE_KEY");
  const adapterPath = requiredEnv("MAGNIBOX_IMAP_ADAPTER_MODULE");
  const adapterRoot = resolve(process.cwd(), "scripts/magnibox");
  const resolvedAdapterPath = resolve(process.cwd(), adapterPath);
  const adapterRelativePath = relative(adapterRoot, resolvedAdapterPath);
  if (!adapterRelativePath || adapterRelativePath.startsWith("..") || isAbsolute(adapterRelativePath)) {
    throw new Error("IMAP adapter module must be inside scripts/magnibox");
  }

  const supabase = createClient(supabaseUrl.toString(), serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { "X-MAGNIBOX-Worker": "imap-sync" } },
  });
  const moduleUrl = pathToFileURL(resolvedAdapterPath).href;
  const adapterModule = await import(moduleUrl) as AdapterModule;
  if (typeof adapterModule.createMagniboxImapSyncAdapter !== "function") {
    throw new Error("IMAP adapter module must export createMagniboxImapSyncAdapter()");
  }
  const adapter = await adapterModule.createMagniboxImapSyncAdapter({ supabase });
  if (!adapter || typeof adapter.apply !== "function") {
    throw new Error("IMAP adapter factory returned an invalid adapter");
  }

  const config = readMagniboxImapWorkerConfig(process.env);
  const repository = createMagniboxSupabaseOutboxRepository(supabase);
  const logger = {
    info(fields: Record<string, unknown>, message: string) {
      process.stdout.write(JSON.stringify({ level: "info", message, ...fields }) + "\n");
    },
    error(fields: Record<string, unknown>, message: string) {
      process.stderr.write(JSON.stringify({ level: "error", message, ...fields }) + "\n");
    },
  };
  const controller = new AbortController();
  const shutdown = (signal: string) => {
    logger.info({ signal }, "MAGNIBOX IMAP worker shutting down");
    controller.abort();
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
  logger.info({ workerId: config.workerId }, "MAGNIBOX IMAP worker started");
  await runMagniboxImapWorker({ repository, adapter, config, logger }, controller.signal);
  logger.info({ workerId: config.workerId }, "MAGNIBOX IMAP worker stopped");
}

main().catch(() => {
  process.stderr.write(JSON.stringify({
    level: "error",
    message: "MAGNIBOX IMAP worker failed to start; verify server-only configuration and adapter module",
  }) + "\n");
  process.exitCode = 1;
});
