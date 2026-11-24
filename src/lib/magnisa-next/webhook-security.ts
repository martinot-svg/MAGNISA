import { createHmac, timingSafeEqual } from "node:crypto";

export type WebhookVerification =
  | { valid: true; timestamp: number }
  | { valid: false; reason: "missing_header" | "invalid_header" | "invalid_timestamp" | "stale_timestamp" | "invalid_secret" | "invalid_signature" };

/**
 * Vérifie une signature HMAC-SHA256 de type t=<unix>,v1=<hex>.
 * Le calcul utilise les octets exacts du corps reçu. Ne parser/re-sérialiser
 * le JSON qu'après vérification. Les webhooks fournisseurs peuvent avoir un
 * format différent : adapter leur enveloppe sans supprimer ces contrôles.
 */
export function verifyHmacWebhook(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
  nowMs: number,
  toleranceSeconds = 300,
): WebhookVerification {
  if (!signatureHeader) return { valid: false, reason: "missing_header" };
  if (!secret || secret.trim() !== secret) return { valid: false, reason: "invalid_secret" };
  if (!Number.isFinite(nowMs) || !Number.isInteger(toleranceSeconds) ||
      toleranceSeconds < 1 || toleranceSeconds > 3600) {
    return { valid: false, reason: "invalid_timestamp" };
  }

  const fields = signatureHeader.split(",").map((field) => field.trim());
  const timestampFields = fields.filter((field) => field.startsWith("t="));
  const signatures = fields
    .filter((field) => field.startsWith("v1="))
    .map((field) => field.slice(3))
    .filter((value) => /^[a-fA-F0-9]{64}$/.test(value));

  if (timestampFields.length !== 1 || signatures.length === 0) {
    return { valid: false, reason: "invalid_header" };
  }

  const timestampText = timestampFields[0].slice(2);
  if (!/^\d{10}$/.test(timestampText)) {
    return { valid: false, reason: "invalid_timestamp" };
  }
  const timestamp = Number(timestampText);
  if (Math.abs(nowMs / 1000 - timestamp) > toleranceSeconds) {
    return { valid: false, reason: "stale_timestamp" };
  }

  const expected = createHmac("sha256", secret)
    .update(timestampText + "." + rawBody, "utf8")
    .digest();

  const valid = signatures.some((signature) => {
    const supplied = Buffer.from(signature, "hex");
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  });

  return valid
    ? { valid: true, timestamp }
    : { valid: false, reason: "invalid_signature" };
}
