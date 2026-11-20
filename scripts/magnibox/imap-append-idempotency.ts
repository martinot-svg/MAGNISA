import { MagniboxSyncError } from "./imap-sync-core";

/**
 * A server-generated operation marker is embedded as an RFC 5322 header in
 * the MIME message before APPEND. IMAP SEARCH HEADER can then recover an
 * operation after the APPEND response was lost.
 */
export const MAGNIBOX_APPEND_MARKER_HEADER = "X-Magnibox-Operation-ID";

export type MagniboxAppendOperationState =
  | "ready"
  | "append_started"
  | "ambiguous"
  | "confirmed";

export type MagniboxAppendSearchMatch = {
  uid: string;
  uidValidity: string;
};

export type MagniboxAppendDecision =
  | { action: "append_allowed"; marker: string }
  | { action: "confirm_existing"; uid: string; uidValidity: string }
  | { action: "search_again"; reason: "append_outcome_ambiguous" | "append_in_progress" }
  | { action: "reconcile_mapping"; reason: "uidvalidity_mismatch" }
  | { action: "duplicate_conflict"; matches: number }
  | { action: "already_confirmed" };

/** Header values must be opaque, server-generated tokens, never user text. */
export function validateMagniboxAppendMarker(marker: string): string {
  if (
    typeof marker !== "string" ||
    marker.length < 16 ||
    marker.length > 128 ||
    !/^[A-Za-z0-9._:-]+$/.test(marker)
  ) {
    throw new MagniboxSyncError("Invalid MAGNIBOX append operation marker", false);
  }
  return marker;
}

/**
 * Decide the next safe action after searching the target IMAP folder for the
 * exact operation marker. Crucially, an APPEND that may have reached the
 * server is never repeated merely because the worker did not receive a reply.
 */
export function decideMagniboxAppendAction(input: {
  marker: string;
  operationState: MagniboxAppendOperationState;
  currentUidValidity: string;
  searchMatches: MagniboxAppendSearchMatch[];
  confirmedUid?: string | null;
  confirmedUidValidity?: string | null;
}): MagniboxAppendDecision {
  const marker = validateMagniboxAppendMarker(input.marker);
  if (!Array.isArray(input.searchMatches)) {
    throw new MagniboxSyncError("Invalid IMAP append search result", false);
  }

  if (input.operationState === "confirmed") {
    if (!input.confirmedUid || !input.confirmedUidValidity) {
      throw new MagniboxSyncError("Confirmed append is missing its UID mapping", false);
    }
    return { action: "already_confirmed" };
  }

  if (input.searchMatches.length > 1) {
    return { action: "duplicate_conflict", matches: input.searchMatches.length };
  }

  if (input.searchMatches.length === 1) {
    const match = input.searchMatches[0];
    if (!match || typeof match.uid !== "string" || typeof match.uidValidity !== "string") {
      throw new MagniboxSyncError("Malformed IMAP append search match", false);
    }
    const uid = positiveBigint(match.uid, "UID");
    const foundEpoch = positiveBigint(match.uidValidity, "UIDVALIDITY");
    const currentEpoch = positiveBigint(input.currentUidValidity, "UIDVALIDITY");
    if (foundEpoch !== currentEpoch) {
      return { action: "reconcile_mapping", reason: "uidvalidity_mismatch" };
    }
    return { action: "confirm_existing", uid, uidValidity: foundEpoch };
  }

  if (input.operationState === "ready") {
    return { action: "append_allowed", marker };
  }
  if (input.operationState === "append_started") {
    return { action: "search_again", reason: "append_in_progress" };
  }
  return { action: "search_again", reason: "append_outcome_ambiguous" };
}

function positiveBigint(value: string, field: string): string {
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) {
    throw new MagniboxSyncError(`Invalid IMAP ${field}`, false);
  }
  const canonical = value.replace(/^0+(?=\d)/, "");
  if (
    canonical === "0" ||
    canonical.length > 19 ||
    (canonical.length === 19 && canonical > "9223372036854775807")
  ) {
    throw new MagniboxSyncError(`IMAP ${field} is outside positive BIGINT range`, false);
  }
  return canonical;
}
