import { MagniboxSyncError } from "./imap-sync-core";

/**
 * PostgreSQL BIGINT values are represented as decimal strings so UID and
 * UIDVALIDITY values never pass through lossy JavaScript number conversion.
 */
export type MagniboxImapUidMapping = {
  uidvalidity: string;
  uid: string | null;
  deletedAt: string | null;
  deleteConfirmedAt: string | null;
};

export type MagniboxImapUidDecision =
  | { action: "append_required" }
  | { action: "reuse_uid"; uid: string }
  | { action: "reconcile_required"; reason: "uidvalidity_changed" | "uid_missing" }
  | { action: "tombstoned" };

/** Validate and canonicalize a positive PostgreSQL BIGINT decimal value. */
export function canonicalPositiveBigint(value: string, field: string): string {
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) {
    throw new MagniboxSyncError(`Invalid IMAP ${field}`, false);
  }

  const canonical = value.replace(/^0+(?=\d)/, "");
  if (canonical === "0" || canonical.length > 19 ||
      (canonical.length === 19 && canonical > "9223372036854775807")) {
    throw new MagniboxSyncError(`IMAP ${field} is outside positive BIGINT range`, false);
  }
  return canonical;
}

/** Validate a non-negative PostgreSQL BIGINT decimal value (MODSEQ may be zero). */
export function canonicalNonNegativeBigint(value: string, field: string): string {
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) {
    throw new MagniboxSyncError(`Invalid IMAP ${field}`, false);
  }

  const canonical = value.replace(/^0+(?=\\d)/, "");
  if (canonical.length > 19 ||
      (canonical.length === 19 && canonical > "9223372036854775807")) {
    throw new MagniboxSyncError(`IMAP ${field} is outside non-negative BIGINT range`, false);
  }
  return canonical;
}

/**
 * Decide whether a stored UID is safe to reuse in the currently selected
 * folder. A UID is meaningful only inside its matching UIDVALIDITY epoch.
 */
export function decideMagniboxImapUidAction(input: {
  currentUidValidity: string;
  mapping: MagniboxImapUidMapping | null;
}): MagniboxImapUidDecision {
  const current = canonicalPositiveBigint(input.currentUidValidity, "UIDVALIDITY");
  const mapping = input.mapping;

  if (!mapping) return { action: "append_required" };

  if (mapping.deletedAt !== null) {
    return { action: "tombstoned" };
  }

  const storedValidity = canonicalPositiveBigint(mapping.uidvalidity, "stored UIDVALIDITY");
  if (storedValidity !== current) {
    return { action: "reconcile_required", reason: "uidvalidity_changed" };
  }

  if (mapping.uid === null) {
    return { action: "reconcile_required", reason: "uid_missing" };
  }

  return {
    action: "reuse_uid",
    uid: canonicalPositiveBigint(mapping.uid, "UID"),
  };
}
