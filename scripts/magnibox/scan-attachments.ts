import { createClient } from "@supabase/supabase-js";
import { connect } from "node:net";
import { createHash, randomUUID } from "node:crypto";
import { buildClamAvInstreamFrames, detectMagniboxAttachmentMime, parseClamAvInstreamResponse } from "./attachment-scan-core";

type Attachment = {
  id: string;
  organization_id: string;
  message_id: string;
  storage_path: string;
  byte_size: number;
  sha256: string;
  scan_status: "quarantined" | "scanning" | "available" | "rejected";
  scan_attempts: number;
};

const BUCKET = "magnibox-attachments";
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const BATCH_SIZE = 10;

async function scanWithClamAV(bytes: Buffer, host: string, port: number): Promise<"clean" | "infected"> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    const chunks: Buffer[] = [];
    let settled = false;
    const finish = (error?: Error, result?: "clean" | "infected") => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve(result!);
    };
    socket.setTimeout(30_000, () => finish(new Error("ClamAV timeout")));
    socket.on("error", error => finish(error));
    socket.on("end", () => finish(new Error("ClamAV closed before complete response")));
    socket.on("data", chunk => {
      chunks.push(chunk);
      const verdict = parseClamAvInstreamResponse(Buffer.concat(chunks));
      if (verdict === "clean") finish(undefined, "clean");
      else if (verdict === "infected") finish(undefined, "infected");
      else if (verdict === "error") finish(new Error("ClamAV scan error"));
    });
    socket.on("connect", () => {
      for (const frame of buildClamAvInstreamFrames(bytes)) socket.write(frame);
    });
  });
}

async function processOne(admin: ReturnType<typeof createClient>, item: Attachment, clamHost: string, clamPort: number) {
  // Atomic compare-and-set prevents two workers from scanning the same object concurrently.
  const leaseToken = randomUUID();
  const claim = await admin.from("orbit_external_message_attachments")
    .update({ scan_status: "scanning", scan_started_at: new Date().toISOString(), scan_lease_token: leaseToken, scan_attempts: item.scan_attempts + 1 })
    .eq("id", item.id)
    .eq("scan_status", "quarantined")
    .lt("scan_attempts", 5)
    .select("id")
    .maybeSingle();
  if (claim.error || !claim.data) return;

  let terminal = false;
  try {
    if (item.byte_size < 1 || item.byte_size > MAX_FILE_BYTES) throw new Error("invalid_size");
    const downloaded = await admin.storage.from(BUCKET).download(item.storage_path);
    if (downloaded.error || !downloaded.data) throw new Error("storage_read_failed");
    const bytes = Buffer.from(await downloaded.data.arrayBuffer());
    if (bytes.length !== item.byte_size || bytes.length > MAX_FILE_BYTES) throw new Error("size_mismatch");
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== item.sha256.toLowerCase()) throw new Error("sha256_mismatch");

    const detected = detectMagniboxAttachmentMime(bytes);
    if (!detected) {
      const rejected = await admin.from("orbit_external_message_attachments")
        .update({ scan_status: "rejected", scan_started_at: null, scan_lease_token: null, scan_completed_at: new Date().toISOString() })
        .eq("id", item.id).eq("scan_status", "scanning").eq("scan_lease_token", leaseToken).select("id").maybeSingle();
      if (rejected.error) throw new Error("status_update_failed");
      if (!rejected.data) { terminal = true; return; }
      terminal = true;
      await admin.storage.from(BUCKET).remove([item.storage_path]);
      return;
    }

    const verdict = await scanWithClamAV(bytes, clamHost, clamPort);
    if (verdict === "infected") {
      const rejected = await admin.from("orbit_external_message_attachments")
        .update({ scan_status: "rejected", scan_started_at: null, scan_lease_token: null, scan_completed_at: new Date().toISOString() })
        .eq("id", item.id).eq("scan_status", "scanning").eq("scan_lease_token", leaseToken).select("id").maybeSingle();
      if (rejected.error) throw new Error("status_update_failed");
      if (!rejected.data) { terminal = true; return; }
      terminal = true;
      await admin.storage.from(BUCKET).remove([item.storage_path]);
      return;
    }

    const available = await admin.from("orbit_external_message_attachments")
      .update({ scan_status: "available", scan_started_at: null, scan_lease_token: null, detected_mime_type: detected, scan_completed_at: new Date().toISOString() })
      .eq("id", item.id).eq("scan_status", "scanning").eq("scan_lease_token", leaseToken).select("id").maybeSingle();
    if (available.error) throw new Error("status_update_failed");
    terminal = true;
    if (!available.data) return;
  } finally {
    // Infrastructure errors are retryable; never expose an unscanned object.
    if (!terminal) {
      await admin.from("orbit_external_message_attachments")
        .update({ scan_status: "quarantined", scan_started_at: null, scan_lease_token: null })
        .eq("id", item.id).eq("scan_status", "scanning").eq("scan_lease_token", leaseToken).select("id").maybeSingle();
    }
  }
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const clamHost = process.env.MAGNIBOX_CLAMAV_HOST || "clamav";
  const clamPort = Number(process.env.MAGNIBOX_CLAMAV_PORT || "3310");
  if (!url || !key) throw new Error("Supabase service credentials are required");
  if (!Number.isInteger(clamPort) || clamPort < 1 || clamPort > 65535) throw new Error("Invalid ClamAV port");

  const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const staleBefore = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const retryable = await admin.from("orbit_external_message_attachments")
    .update({ scan_status: "quarantined", scan_started_at: null, scan_lease_token: null })
    .eq("scan_status", "scanning").lt("scan_attempts", 5).lt("scan_started_at", staleBefore);
  if (retryable.error) throw new Error("Unable to recover stale scan leases");
  const exhausted = await admin.from("orbit_external_message_attachments")
    .update({ scan_status: "rejected", scan_started_at: null, scan_lease_token: null, scan_completed_at: new Date().toISOString() })
    .eq("scan_status", "scanning").gte("scan_attempts", 5).lt("scan_started_at", staleBefore);
  if (exhausted.error) throw new Error("Unable to reject exhausted scan leases");

  const exhaustedQueued = await admin.from("orbit_external_message_attachments")
    .update({ scan_status: "rejected", scan_started_at: null, scan_lease_token: null, scan_completed_at: new Date().toISOString() })
    .eq("scan_status", "quarantined").gte("scan_attempts", 5);
  if (exhaustedQueued.error) throw new Error("Unable to reject exhausted queued scans");

  const pending = await admin.from("orbit_external_message_attachments")
    .select("id,organization_id,message_id,storage_path,byte_size,sha256,scan_status,scan_attempts")
    .eq("scan_status", "quarantined")
    .order("created_at", { ascending: true })
    .limit(BATCH_SIZE);
  if (pending.error) throw new Error("Unable to load quarantined MAGNIBOX attachments");

  for (const item of (pending.data ?? []) as Attachment[]) {
    try {
      await processOne(admin, item, clamHost, clamPort);
      process.stdout.write(`Processed MAGNIBOX attachment ${item.id}\n`);
    } catch {
      // Do not log message contents, paths, credentials, or scanner diagnostics.
      process.stderr.write(`MAGNIBOX attachment scan deferred: ${item.id}\n`);
    }
  }
}

main().catch(() => {
  process.stderr.write("MAGNIBOX attachment worker failed closed\n");
  process.exitCode = 1;
});
