import { createHmac, timingSafeEqual } from "node:crypto";
import { normalizeHeaderFrom, normalizePublicEmail } from "./address";

export type MagniboxInboundPayload = {
  messageId: string;
  from: string;
  to: string[];
  subject: string;
  text: string;
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
    || d.subject.trim().length < 1 || d.subject.length > 180 || d.text.length > 100000) {
    throw new Error("Payload entrant invalide.");
  }
  const to = [...new Set(d.to.map(x => normalizePublicEmail(x as string)))];
  if (to.length !== d.to.length) throw new Error("Destinataires entrants dupliqués.");
  return {
    messageId: d.messageId,
    from: normalizeHeaderFrom(d.from),
    to,
    subject: d.subject.trim(),
    text: d.text,
  };
}
