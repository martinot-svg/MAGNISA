import { createHmac, timingSafeEqual } from "node:crypto";
import { normalizeHeaderFrom, normalizePublicEmail } from "./address";

// Keep this aligned with orbit_external_messages.body_text CHECK(char_length <= 50000).
export const MAGNIBOX_INBOUND_MAX_TEXT_CHARS = 50_000;
export const MAGNIBOX_INBOUND_MAX_ATTACHMENTS = 5;
export const MAGNIBOX_INBOUND_MAX_ATTACHMENT_BYTES = 30 * 1024 * 1024;
export const MAGNIBOX_INBOUND_MAX_TOTAL_ATTACHMENT_BYTES = 150 * 1024 * 1024;
// JSON/base64 envelope ceiling; aligned with the Postfix bridge and MTA limit.
export const MAGNIBOX_INBOUND_MAX_REQUEST_BYTES = 205 * 1024 * 1024;

export type MagniboxInboundAttachment = { fileName: string; contentType: string; contentBase64: string };

export type MagniboxInboundPayload = {
  messageId: string;
  from: string;
  to: string[];
  subject: string;
  text: string;
  attachments: MagniboxInboundAttachment[];
};

export function verifyMagniboxInboundSignature(
  rawBody: string,
  timestamp: string | null,
  signature: string | null,
  secret: string,
  nowMilliseconds = Date.now(),
): boolean {
  if (!timestamp || !signature || !/^\d{10}$/.test(timestamp)
    || Math.abs(nowMilliseconds - Number(timestamp) * 1000) > 300000
    || secret.trim().length < 32 || !/^sha256=[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest();
  const actual = Buffer.from(signature.slice(7), "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function parseMagniboxInboundPayload(value: unknown): MagniboxInboundPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Payload entrant invalide.");
  const d = value as Record<string, unknown>;
  if (typeof d.messageId !== "string" || !/^[A-Za-z0-9._:@+-]{1,200}$/.test(d.messageId)
    || typeof d.from !== "string" || !Array.isArray(d.to)
    || d.to.length < 1 || d.to.length > 10 || !d.to.every(x => typeof x === "string")
    || typeof d.subject !== "string" || typeof d.text !== "string"
    || d.subject.trim().length < 1 || d.subject.length > 180
    || d.text.length > MAGNIBOX_INBOUND_MAX_TEXT_CHARS) throw new Error("Payload entrant invalide.");
  const to = [...new Set(d.to.map(x => normalizePublicEmail(x as string)))];
  if (to.length !== d.to.length) throw new Error("Destinataires entrants dupliqués.");
  const raw = d.attachments === undefined ? [] : d.attachments;
  if (!Array.isArray(raw) || raw.length > MAGNIBOX_INBOUND_MAX_ATTACHMENTS) throw new Error("Liste de pièces jointes invalide.");
  let total = 0;
  const attachments = raw.map((item): MagniboxInboundAttachment => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Pièce jointe invalide.");
    const a = item as Record<string, unknown>;
    if (typeof a.fileName !== "string" || typeof a.contentType !== "string" || typeof a.contentBase64 !== "string"
      || a.fileName.length < 1 || a.fileName.length > 180 || /[\r\n]/.test(a.fileName)
      || a.contentType.length < 1 || a.contentType.length > 120
      || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(a.contentType)
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(a.contentBase64)) {
      throw new Error("Métadonnées de pièce jointe invalides.");
    }
    const bytes = Buffer.from(a.contentBase64, "base64");
    if (bytes.length < 1 || bytes.length > MAGNIBOX_INBOUND_MAX_ATTACHMENT_BYTES
      || bytes.toString("base64") !== a.contentBase64) throw new Error("Taille ou encodage invalide.");
    total += bytes.length;
    if (total > MAGNIBOX_INBOUND_MAX_TOTAL_ATTACHMENT_BYTES) throw new Error("Taille totale dépassée.");
    const fileName = a.fileName.replace(/[\\/]/g, "_").replace(/[^\x20-\x7e]/g, "_").slice(0, 180) || "attachment.bin";
    return { fileName, contentType: a.contentType.toLowerCase(), contentBase64: a.contentBase64 };
  });
  return { messageId: d.messageId, from: normalizeHeaderFrom(d.from), to, subject: d.subject.trim(), text: d.text, attachments };
}


export class MagniboxInboundBodyTooLargeError extends Error {
  constructor() {
    super("Inbound request body exceeds the configured limit.");
    this.name = "MagniboxInboundBodyTooLargeError";
  }
}

/** Read a signed webhook body with a hard byte ceiling before allocating it. */
export async function readMagniboxBoundedBody(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new RangeError("Invalid body limit.");
  if (!body) throw new Error("Missing request body.");
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch((): void => undefined);
        throw new MagniboxInboundBodyTooLargeError();
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, total));
}


/** Reject a declared decimal Content-Length above the gateway ceiling. */
export function isMagniboxInboundContentLengthTooLarge(value: string | null, maxBytes: number): boolean {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new RangeError("Invalid body limit.");
  if (value === null || !/^\d+$/.test(value)) return false;
  const declared = Number(value);
  return Number.isSafeInteger(declared) && declared > maxBytes;
}


/** Backwards-compatible name for the inbound gateway's bounded reader. */
export async function readMagniboxInboundBody(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<string> {
  return readMagniboxBoundedBody(body, maxBytes);
}
