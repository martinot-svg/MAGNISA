import { createClient } from "@supabase/supabase-js";
import { connect } from "node:net";
import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";

type Attachment = {
  id: string;
  organization_id: string;
  message_id: string;
  storage_path: string;
  byte_size: number;
  sha256: string;
  scan_status: "quarantined" | "scanning" | "available" | "rejected";
};

const BUCKET = "magnibox-attachments";
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const BATCH_SIZE = 10;

export function detectMime(bytes: Buffer): string | null {
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))) return "image/gif";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF"
    && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";

  // Text is accepted only when it is valid UTF-8 and contains no binary NUL bytes.
  if (bytes.length > 0 && !bytes.includes(0)) {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      return "text/plain";
    } catch { /* unsupported binary format */ }
  }
  return null;
}

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
    socket.on("data", chunk => {
      chunks.push(chunk);
      const response = Buffer.concat(chunks).toString("utf8");
      if (response.includes(" INSTREAM size limit exceeded")) finish(new Error("ClamAV stream limit exceeded"));
      else if (response.endsWith(" OK\\0")) finish(undefined, "clean");
      else if (/ FOUND\\0$/.test(response)) finish(undefined, "infected");
      else if (response.includes(" ERROR\\0")) finish(new Error("ClamAV scan error"));
    });
    socket.on("connect", () => {
      socket.write("zINSTREAM\\0");
      const chunkSize = 64 * 1024;
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        const part = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
        const header = Buffer.alloc(4);
        header.writeUInt32BE(part.length, 0);
        socket.write(header);
        socket.write(part);
      }
      socket.write(Buffer.alloc(4));
    });
  });
}

async function processOne(admin: ReturnType<typeof createClient>, item: Attachment, clamHost: string, clamPort: number) {
  // Atomic compare-and-set prevents two workers from scanning the same object concurrently.
  const claim = await admin.from("orbit_external_message_attachments")
    .update({ scan_status: "scanning" })
    .eq("id", item.id)
    .eq("scan_status", "quarantined")
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

    const detected = detectMime(bytes);
    if (!detected) {
      await admin.from("orbit_external_message_attachments")
        .update({ scan_status: "rejected", scan_completed_at: new Date().toISOString() })
        .eq("id", item.id).eq("scan_status", "scanning");
      terminal = true;
      await admin.storage.from(BUCKET).remove([item.storage_path]);
      return;
    }

    const verdict = await scanWithClamAV(bytes, clamHost, clamPort);
    if (verdict === "infected") {
      const rejected = await admin.from("orbit_external_message_attachments")
        .update({ scan_status: "rejected", scan_completed_at: new Date().toISOString() })
        .eq("id", item.id).eq("scan_status", "scanning");
      if (rejected.error) throw new Error("status_update_failed");
      terminal = true;
      await admin.storage.from(BUCKET).remove([item.storage_path]);
      return;
    }

    const available = await admin.from("orbit_external_message_attachments")
      .update({ scan_status: "available", detected_mime_type: detected, scan_completed_at: new Date().toISOString() })
      .eq("id", item.id).eq("scan_status", "scanning");
    if (available.error) throw new Error("status_update_failed");
    terminal = true;
  } finally {
    // Infrastructure errors are retryable; never expose an unscanned object.
    if (!terminal) {
      await admin.from("orbit_external_message_attachments")
        .update({ scan_status: "quarantined" })
        .eq("id", item.id).eq("scan_status", "scanning");
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
  const pending = await admin.from("orbit_external_message_attachments")
    .select("id,organization_id,message_id,storage_path,byte_size,sha256,scan_status")
    .eq("scan_status", "quarantined")
    .order("created_at", { ascending: true })
    .limit(BATCH_SIZE);
  if (pending.error) throw new Error("Unable to load quarantined MAGNIBOX attachments");

  for (const item of (pending.data ?? []) as Attachment[]) {
    try {
      await processOne(admin, item, clamHost, clamPort);
      process.stdout.write(`Processed MAGNIBOX attachment ${item.id}\\n`);
    } catch {
      // Do not log message contents, paths, credentials, or scanner diagnostics.
      process.stderr.write(`MAGNIBOX attachment scan deferred: ${item.id}\\n`);
    }
  }
}

main().catch(() => {
  process.stderr.write("MAGNIBOX attachment worker failed closed\\n");
  process.exitCode = 1;
});
