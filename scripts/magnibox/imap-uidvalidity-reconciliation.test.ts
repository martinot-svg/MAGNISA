import { describe, expect, it } from "vitest";
import { MagniboxSyncError } from "./imap-sync-core";
import { planMagniboxUidValidityReconciliation } from "./imap-uidvalidity-reconciliation";

const marker = "mbxop-12345678-1234-4234-8234-123456789abc";
const operation = {
  operationId: "operation-1",
  sourceMessageId: "message-1",
  marker,
  state: "confirmed" as const,
  uidValidity: "10",
  uid: "3",
};

describe("UIDVALIDITY reconciliation planner", () => {
  it("rebinds confirmed APPEND markers in the new epoch without changing unrelated messages", () => {
    expect(planMagniboxUidValidityReconciliation({
      previousUidValidity: "10",
      currentUidValidity: "11",
      inventoryComplete: true,
      serverScanComplete: true,
      operations: [operation],
      serverMessages: [{ uid: "9", marker }, { uid: "12", marker: null }],
      mappings: [{ sourceMessageId: "message-1", uidValidity: "10", uid: "3" }],
    })).toEqual({
      previousUidValidity: "10",
      currentUidValidity: "11",
      rebind: [{ sourceMessageId: "message-1", operationId: "operation-1", uid: "9" }],
      missing: [],
      unmanagedServerUids: ["12"],
    });
  });

  it("reports a confirmed message missing from the new epoch for canonical resync", () => {
    const plan = planMagniboxUidValidityReconciliation({
      previousUidValidity: "10",
      currentUidValidity: "11",
      inventoryComplete: true,
      serverScanComplete: true,
      operations: [operation],
      serverMessages: [],
      mappings: [{ sourceMessageId: "message-1", uidValidity: "10", uid: "3" }],
    });
    expect(plan.missing).toEqual([{ sourceMessageId: "message-1", operationId: "operation-1" }]);
    expect(plan.rebind).toEqual([]);
  });

  it.each([
    { inventoryComplete: false, serverScanComplete: true },
    { inventoryComplete: true, serverScanComplete: false },
  ])("fails closed when either inventory is incomplete", completeness => {
    expect(() => planMagniboxUidValidityReconciliation({
      previousUidValidity: "10",
      currentUidValidity: "11",
      ...completeness,
      operations: [operation],
      serverMessages: [],
      mappings: [],
    })).toThrow(MagniboxSyncError);
  });

  it("rejects duplicate server markers rather than selecting an arbitrary UID", () => {
    expect(() => planMagniboxUidValidityReconciliation({
      previousUidValidity: "10",
      currentUidValidity: "11",
      inventoryComplete: true,
      serverScanComplete: true,
      operations: [operation],
      serverMessages: [{ uid: "9", marker }, { uid: "10", marker }],
      mappings: [],
    })).toThrow("duplicate server operation markers");
  });

  it("rejects unknown operation markers and duplicate UIDs", () => {
    expect(() => planMagniboxUidValidityReconciliation({
      previousUidValidity: "10",
      currentUidValidity: "11",
      inventoryComplete: true,
      serverScanComplete: true,
      operations: [operation],
      serverMessages: [{ uid: "9", marker: "mbxop-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }],
      mappings: [],
    })).toThrow("unknown operation marker");
    expect(() => planMagniboxUidValidityReconciliation({
      previousUidValidity: "10",
      currentUidValidity: "11",
      inventoryComplete: true,
      serverScanComplete: true,
      operations: [operation],
      serverMessages: [{ uid: "9", marker: null }, { uid: "9", marker: null }],
      mappings: [],
    })).toThrow("duplicate or invalid UIDs");
  });
});
