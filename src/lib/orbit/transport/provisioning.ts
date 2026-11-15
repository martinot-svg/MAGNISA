import { createHmac, timingSafeEqual } from "node:crypto";

export type MagniboxProvisioningSnapshot = {
  generatedAt: string;
  domains: string[];
  recipients: string[];
  revision: string;
};

/** Read every bounded Supabase page; fail closed rather than publish a truncated directory. */
export async function collectMagniboxProvisioningRows<T>(
  fetchPage: (from: number, to: number) => Promise<T[]>,
  pageSize = 500,
  maxRows = 10000,
): Promise<T[]> {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000
    || !Number.isInteger(maxRows) || maxRows < 1) {
    throw new Error("Invalid Magnibox provisioning pagination bounds.");
  }
  const rows: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await fetchPage(offset, offset + pageSize - 1);
    if (page.length > pageSize || rows.length + page.length > maxRows) {
      throw new Error("Magnibox provisioning directory exceeds its safe limit.");
    }
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

export function verifyMagniboxProvisioningRequest(
  rawBody: string,
  timestamp: string | null,
  signature: string | null,
  secret: string,
  nowMilliseconds = Date.now(),
): boolean {
  if (!timestamp || !signature || !/^\\d{10}$/.test(timestamp)
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
