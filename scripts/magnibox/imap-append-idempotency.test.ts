import { describe, expect, it } from "vitest";
import {
  decideMagniboxAppendAction,
  MAGNIBOX_APPEND_MARKER_HEADER,
  validateMagniboxAppendMarker,
} from "./imap-append-idempotency";
import { MagniboxSyncError } from "./imap-sync-core";

const marker = "magnibox-op:01J8Y5M4T8K9Q2W7";

describe("MAGNIBOX APPEND idempotency policy", () => {
  it("uses a dedicated MIME header name for server-side recovery", () => {
    expect(MAGNIBOX_APPEND_MARKER_HEADER).toBe("X-Magnibox-Operation-ID");
    expect(validateMagniboxAppendMarker(marker)).toBe(marker);
  });

  it("allows APPEND only when the durable operation has never started", () => {
    expect(decideMagniboxAppendAction({
      marker,
      operationState: "ready",
      currentUidValidity: "42",
      searchMatches: [],
    })).toEqual({ action: "append_allowed", marker });
  });

  it("never repeats APPEND after an ambiguous response with no search match", () => {
    expect(decideMagniboxAppendAction({
      marker,
      operationState: "ambiguous",
      currentUidValidity: "42",
      searchMatches: [],
    })).toEqual({ action: "search_again", reason: "append_outcome_ambiguous" });
  });

  it("keeps an in-flight append in search/recovery instead of issuing another append", () => {
    expect(decideMagniboxAppendAction({
      marker,
      operationState: "append_started",
      currentUidValidity: "42",
      searchMatches: [],
    })).toEqual({ action: "search_again", reason: "append_in_progress" });
  });

  it("recovers the UID from one exact marker match without appending again", () => {
    expect(decideMagniboxAppendAction({
      marker,
      operationState: "ambiguous",
      currentUidValidity: "42",
      searchMatches: [{ uid: "9007199254740993", uidValidity: "42" }],
    })).toEqual({
      action: "confirm_existing",
      uid: "9007199254740993",
      uidValidity: "42",
    });
  });

  it("requires reconciliation if the marker is found in a different UIDVALIDITY epoch", () => {
    expect(decideMagniboxAppendAction({
      marker,
      operationState: "ambiguous",
      currentUidValidity: "43",
      searchMatches: [{ uid: "7", uidValidity: "42" }],
    })).toEqual({ action: "reconcile_mapping", reason: "uidvalidity_mismatch" });
  });

  it("fails closed when the marker matches more than one message", () => {
    expect(decideMagniboxAppendAction({
      marker,
      operationState: "ambiguous",
      currentUidValidity: "42",
      searchMatches: [
        { uid: "7", uidValidity: "42" },
        { uid: "8", uidValidity: "42" },
      ],
    })).toEqual({ action: "duplicate_conflict", matches: 2 });
  });

  it("does not trust a confirmed state without its durable UID mapping", () => {
    expect(() => decideMagniboxAppendAction({
      marker,
      operationState: "confirmed",
      currentUidValidity: "42",
      searchMatches: [],
    })).toThrow(MagniboxSyncError);
  });

  it("does not permit header injection or malformed markers", () => {
    expect(() => validateMagniboxAppendMarker("valid-marker\r\nBcc: attacker@example.com"))
      .toThrow(MagniboxSyncError);
    expect(() => validateMagniboxAppendMarker("short")).toThrow(MagniboxSyncError);
  });

  it("rejects invalid or out-of-range server UIDs", () => {
    expect(() => decideMagniboxAppendAction({
      marker,
      operationState: "ready",
      currentUidValidity: "42",
      searchMatches: [{ uid: "9223372036854775808", uidValidity: "42" }],
    })).toThrow(MagniboxSyncError);
  });
});
