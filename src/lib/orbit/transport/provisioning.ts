import { createHmac, timingSafeEqual } from "node:crypto";

export type MagniboxProvisioningSnapshot = {
  generatedAt: string;
  domains: string[];
  recipients: string[];
  revision: string;
};

export function verifyMagniboxProvisioningRequest(
  rawBody: string,
  timestamp: string | null,
  signature: string | null,
  secret: string,
  nowMilliseconds = Date.now(),
): boolean {
  if (!timestamp || !signature || !/^\d{10}$/.test(timestamp)
    || Math.abs(nowMilliseconds - Number(timestamp) * 1000) > 300000
    || secret.trim().length < 32 || !/^sha256=[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(timestamp + "." + rawBody).digest();
  const actual = Buffer.from(signature.slice(7), "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function signMagniboxProvisioningResponse(
  rawBody: string,
  timestamp: string,
  secret: string,
): string {
  return "sha256=" + createHmac("sha256", secret).update(timestamp + "." + rawBody).digest("hex");
}

export function isMagniboxProvisioningSnapshot(value: unknown): value is MagniboxProvisioningSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  return typeof data.generatedAt === "string"
    && Number.isFinite(Date.parse(data.generatedAt))
    && typeof data.revision === "string" && /^[a-f0-9]{64}$/.test(data.revision)
    && Array.isArray(data.domains) && data.domains.every(x => typeof x === "string")
    && Array.isArray(data.recipients) && data.recipients.every(x => typeof x === "string");
}
