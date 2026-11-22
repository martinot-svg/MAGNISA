import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createMagniboxSupabaseCredentialProvider } from "./imap-credential-supabase-provider";
import { loadMagniboxCredentialKeyring } from "./imap-credential-crypto";
import { createMagniboxSupabaseOutboxRepository } from "./imap-sync-supabase-repository";
import {
  createMagniboxSupabaseInternalMessageResolverRepository,
  type MagniboxResolverSupabaseClient,
} from "./canonical-internal-message-supabase-repository";
import { createMagniboxInternalMessageImapSyncAdapter } from "./internal-message-imap-sync-adapter";
import { createMagniboxSupabaseImapAppendLedgerRepository } from "./imap-append-supabase-repository";
import { createMagniboxSupabaseImapMappingRepository } from "./imap-mapping-supabase-repository";
import { MagniboxDovecotImapAdapter } from "./dovecot-imap-adapter";
import { createMagniboxDovecotProjectionSink } from "./dovecot-projection-sink";
import { runMagniboxSyncBatch } from "./imap-sync-core";
import { MagniboxSyncError } from "./imap-sync-core";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`Missing required environment variable: ${name}`);
  return value.trim();
}

function assertWorkerSupabaseUrl(value: string, mode: "isolated" | "production"): void {
  const url = new URL(value);
  if (url.username || url.password || url.hash) {
    throw new Error("Supabase worker URL must not contain credentials or a fragment");
  }
  if (mode === "isolated") {
    const allowed = new Set(["localhost", "127.0.0.1", "::1", "host.docker.internal"]);
    if (url.protocol !== "http:" || !allowed.has(url.hostname)) {
      throw new Error("Isolated IMAP worker accepts only a local Supabase URL");
    }
    return;
  }
  if (url.protocol !== "https:" || (url.port && url.port !== "443")) {
    throw new Error("Production IMAP worker requires Supabase HTTPS on port 443");
  }
}

/** RFC 2047 encoded-word helper for display names and subject. */
function encodedWord(value: string): string {
  const clean = value.replace(/[\r\n\x00-\x1f\x7f]/g, " ").trim();
  return `=?UTF-8?B?${Buffer.from(clean, "utf8").toString("base64")}?=`;
}

function mailboxAddress(localPart: string, organizationSlug: string): string {
  if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}$/.test(localPart)
    || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(organizationSlug)) {
    throw new MagniboxSyncError("Canonical internal mailbox address is invalid", false);
  }
  return `${localPart}@${organizationSlug}.magnibox`;
}

function composePlainTextMessage(input: {
  projection: {
    sender: { localPart: string; displayName: string };
    recipient: { localPart: string; displayName: string };
    subject: string;
    bodyText: string;
    createdAt: string;
    sourceMessageId: string;
  };
  organizationSlug: string;
  operationMarker: string;
}): Buffer {
  const { projection, organizationSlug, operationMarker } = input;
  const subject = projection.subject.replace(/[\r\n\x00-\x1f\x7f]/g, " ").trim();
  if (!subject || Buffer.byteLength(subject, "utf8") > 600) {
    throw new MagniboxSyncError("Canonical subject is empty or exceeds the pilot limit", false);
  }
  if (typeof projection.bodyText !== "string" || Buffer.byteLength(projection.bodyText, "utf8") > 2_000_000) {
    throw new MagniboxSyncError("Canonical body is invalid or exceeds the pilot limit", false);
  }
  const from = mailboxAddress(projection.sender.localPart, organizationSlug);
  const to = mailboxAddress(projection.recipient.localPart, organizationSlug);
  const fromName = projection.sender.displayName ? `${encodedWord(projection.sender.displayName)} ` : "";
  const toName = projection.recipient.displayName ? `${encodedWord(projection.recipient.displayName)} ` : "";
  const body = Buffer.from(projection.bodyText.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64");
  const wrappedBody = body.match(/.{1,76}/g)?.join("\r\n") ?? "";
  const date = new Date(projection.createdAt);
  if (!Number.isFinite(date.getTime())) throw new MagniboxSyncError("Canonical message date is invalid", false);

  const headers = [
    `From: ${fromName}<${from}>`,
    `To: ${toName}<${to}>`,
    `Subject: ${encodedWord(subject)}`,
    `Date: ${date.toUTCString()}`,
    `Message-ID: <${projection.sourceMessageId}@${organizationSlug}.magnibox>`,
    `X-Magnibox-Operation-ID: ${operationMarker}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
  ];
  return Buffer.from(`${headers.join("\r\n")}\r\n\r\n${wrappedBody}\r\n`, "utf8");
}

async function main(): Promise<void> {
  const mode = requiredEnv("MAGNIBOX_IMAP_WORKER_MODE");
  if (mode !== "isolated" && mode !== "production") {
    throw new Error("MAGNIBOX_IMAP_WORKER_MODE must be isolated or production");
  }
  const supabaseUrl = requiredEnv("SUPABASE_URL");
  assertWorkerSupabaseUrl(supabaseUrl, mode);
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const allowedHosts = new Set(requiredEnv("MAGNIBOX_IMAP_ALLOWED_HOSTS")
    .split(",").map((host) => host.trim().toLowerCase()).filter(Boolean));
  if (allowedHosts.size === 0) throw new Error("No Dovecot host allowlist is configured");
  if (mode === "production") {
    const unsafeHost = [...allowedHosts].find((host) =>
      host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")
      || host === "127.0.0.1" || host === "::1" || host === "host.docker.internal");
    if (unsafeHost) throw new Error("Production Dovecot allowlist must not contain loopback or local-only hosts");
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const keyring = loadMagniboxCredentialKeyring();
  const credentials = createMagniboxSupabaseCredentialProvider(supabase, keyring);
  const outbox = createMagniboxSupabaseOutboxRepository(supabase);
  const resolver = createMagniboxSupabaseInternalMessageResolverRepository(
    supabase as unknown as MagniboxResolverSupabaseClient,
  );
  const appendLedger = createMagniboxSupabaseImapAppendLedgerRepository(supabase);
  const mappings = createMagniboxSupabaseImapMappingRepository(supabase);
  const caFile = requiredEnv("MAGNIBOX_IMAP_CA_FILE");
  const caPem = readFileSync(caFile, "utf8");
  const transport = new MagniboxDovecotImapAdapter({ allowedHosts, caPem });
  const sink = createMagniboxDovecotProjectionSink({
    credentials,
    transport,
    appendLedger,
    mappings,
    async resolveTargetFolder({ organizationId, mailboxId, role }) {
      const folderKey = role === "sender" ? "sent" : "inbox";
      const { data, error } = await supabase.from("magnibox_imap_folder_state")
        .select("id,mailbox_id,organization_id,namespace,folder_key,imap_folder_name,uidvalidity")
        .eq("organization_id", organizationId)
        .eq("mailbox_id", mailboxId)
        .eq("namespace", "internal")
        .eq("folder_key", folderKey)
        .maybeSingle();
      if (error) throw new MagniboxSyncError("Dovecot folder lookup failed");
      if (!data || data.organization_id !== organizationId || data.mailbox_id !== mailboxId) {
        throw new MagniboxSyncError("Dovecot folder is not provisioned for this mailbox", false);
      }
      return {
        folderStateId: data.id,
        mailboxPath: data.imap_folder_name,
        storedUidValidity: String(data.uidvalidity),
      };
    },
    async observeFolder({ organizationId, mailboxId, folderStateId, previousUidValidity, snapshot }) {
      // Epoch changes require an explicit reconciliation workflow. Never
      // overwrite the old epoch or reuse old UIDs automatically.
      if (snapshot.uidValidity !== previousUidValidity) return false;
      const { data, error } = await supabase.from("magnibox_imap_folder_state")
        .update({
          uidnext: snapshot.uidNext,
          highest_modseq: snapshot.highestModseq,
        })
        .eq("id", folderStateId)
        .eq("organization_id", organizationId)
        .eq("mailbox_id", mailboxId)
        .eq("namespace", "internal")
        .eq("uidvalidity", previousUidValidity)
        .select("id")
        .maybeSingle();
      if (error) throw new MagniboxSyncError("Dovecot folder state update failed");
      return Boolean(data?.id);
    },
    async composeMessage({ projection, operationMarker }) {
      const { data, error } = await supabase.from("magnibox_internal_namespaces")
        .select("slug")
        .eq("organization_id", projection.organizationId)
        .maybeSingle();
      if (error || typeof data?.slug !== "string") {
        throw new MagniboxSyncError("MAGNIBOX namespace could not be resolved", false);
      }
      return composePlainTextMessage({
        projection,
        organizationSlug: data.slug,
        operationMarker,
      });
    },
  });

  const adapter = createMagniboxInternalMessageImapSyncAdapter(resolver, sink);
  const result = await runMagniboxSyncBatch(outbox, adapter, {
    workerId: process.env.MAGNIBOX_IMAP_WORKER_ID?.trim() || `magnibox-imap-${mode}-${process.pid}`,
    batchSize: 10,
    leaseSeconds: 180,
    maxAttempts: 12,
  });
  process.stdout.write(JSON.stringify(result) + "\n");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown worker failure";
  process.stderr.write(`MAGNIBOX IMAP worker stopped: ${message.slice(0, 240)}\n`);
  process.exitCode = 1;
});
