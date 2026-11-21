import { describe, expect, it } from "vitest";
import { MagniboxSyncError } from "./imap-sync-core";
import {
  canonicalPositiveBigint,
  canonicalNonNegativeBigint,
  decideMagniboxImapUidAction,
  type MagniboxImapUidMapping,
} from "./imap-uid-mapping";

const mapping = (overrides: Partial<MagniboxImapUidMapping> = {}): MagniboxImapUidMapping => ({
  uidvalidity: "42",
  uid: "9007199254740993",
  deletedAt: null,
  deleteConfirmedAt: null,
  ...overrides,
});

describe("canonicalPositiveBigint", () => {
  it("preserves values larger than Number.MAX_SAFE_INTEGER exactly", () => {
    expect(canonicalPositiveBigint("09007199254740993", "UID")).toBe("9007199254740993");
  });

  it.each(["", "0", "-1", "1.2", "abc", "9223372036854775808"])(
    "rejects invalid positive BIGINT values (%s)",
    (value) => {
      expect(() => canonicalPositiveBigint(value, "UID")).toThrow(MagniboxSyncError);
    },
  );
});

describe("canonicalNonNegativeBigint", () => {
  it("normalizes leading zeros and preserves zero", () => {
    expect(canonicalNonNegativeBigint("00042", "MODSEQ")).toBe("42");
    expect(canonicalNonNegativeBigint("000", "MODSEQ")).toBe("0");
  });

  it("rejects values outside the PostgreSQL BIGINT range", () => {
    expect(() => canonicalNonNegativeBigint("9223372036854775808", "MODSEQ"))
      .toThrow(MagniboxSyncError);
  });
});

describe("decideMagniboxImapUidAction", () => {
  it("requires append when no durable mapping exists", () => {
    expect(decideMagniboxImapUidAction({
      currentUidValidity: "42",
      mapping: null,
    })).toEqual({ action: "append_required" });
  });

  it("reuses a UID only when UIDVALIDITY matches exactly", () => {
    expect(decideMagniboxImapUidAction({
      currentUidValidity: "42",
      mapping: mapping(),
    })).toEqual({ action: "reuse_uid", uid: "9007199254740993" });
  });

  it("never reuses an old UID after UIDVALIDITY changes", () => {
    expect(decideMagniboxImapUidAction({
      currentUidValidity: "43",
      mapping: mapping(),
    })).toEqual({ action: "reconcile_required", reason: "uidvalidity_changed" });
  });

  it("requires reconciliation for a mapping without a confirmed UID", () => {
    expect(decideMagniboxImapUidAction({
      currentUidValidity: "42",
      mapping: mapping({ uid: null }),
    })).toEqual({ action: "reconcile_required", reason: "uid_missing" });
  });

  it("never appends or reuses a tombstoned mapping", () => {
    expect(decideMagniboxImapUidAction({
      currentUidValidity: "42",
      mapping: mapping({ deletedAt: "2026-11-20T10:00:00.000Z" }),
    })).toEqual({ action: "tombstoned" });
  });

  it("rejects invalid current UIDVALIDITY", () => {
    expect(() => decideMagniboxImapUidAction({
      currentUidValidity: "0",
      mapping: null,
    })).toThrow(MagniboxSyncError);
  });
});
