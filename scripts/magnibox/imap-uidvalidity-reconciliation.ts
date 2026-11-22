import { MagniboxSyncError } from "./imap-sync-core";

export type MagniboxEpochAppendOperation = {
  operationId: string;
  sourceMessageId: string;
  marker: string;
  state: "ready" | "append_started" | "ambiguous" | "confirmed";
  uidValidity: string;
  uid: string | null;
};

export type MagniboxEpochServerMessage = {
  uid: string;
  marker: string | null;
};

export type MagniboxEpochMapping = {
  sourceMessageId: string;
  uidValidity: string;
  uid: string;
};

export type MagniboxEpochReconciliationPlan = {
  previousUidValidity: string;
  currentUidValidity: string;
  rebind: Array<{ sourceMessageId: string; operationId: string; uid: string }>;
  missing: Array<{ sourceMessageId: string; operationId: string }>;
  unmanagedServerUids: string[];
};

/**
 * Produces a no-write reconciliation plan for a changed UIDVALIDITY epoch.
 * Callers must supply a complete server scan and all pages of the durable
 * operation inventory. This function intentionally does not update SQL state.
 */
export function planMagniboxUidValidityReconciliation(input: {
  previousUidValidity: string;
  currentUidValidity: string;
  inventoryComplete: boolean;
  serverScanComplete: boolean;
  operations: MagniboxEpochAppendOperation[];
  serverMessages: MagniboxEpochServerMessage[];
  mappings: MagniboxEpochMapping[];
}): MagniboxEpochReconciliationPlan {
  const { previousUidValidity, currentUidValidity } = input;
  if (!/^[1-9][0-9]*$/.test(previousUidValidity)
    || !/^[1-9][0-9]*$/.test(currentUidValidity)
    || previousUidValidity === currentUidValidity) {
    throw new MagniboxSyncError("UIDVALIDITY reconciliation requires two distinct valid epochs", false);
  }
  if (!input.inventoryComplete || !input.serverScanComplete) {
    throw new MagniboxSyncError("UIDVALIDITY reconciliation requires complete inventories", false);
  }

  const operationByMarker = new Map<string, MagniboxEpochAppendOperation>();
  const operationBySource = new Map<string, MagniboxEpochAppendOperation>();
  for (const operation of input.operations) {
    if (!/^mbxop-[0-9a-f-]{36}$/.test(operation.marker)
      || operationByMarker.has(operation.marker)
      || operationBySource.has(operation.sourceMessageId)) {
      throw new MagniboxSyncError("UIDVALIDITY reconciliation inventory has duplicate or invalid operations", false);
    }
    operationByMarker.set(operation.marker, operation);
    operationBySource.set(operation.sourceMessageId, operation);
  }

  const serverByMarker = new Map<string, string[]>();
  const serverUids = new Set<string>();
  for (const message of input.serverMessages) {
    if (!/^[1-9][0-9]*$/.test(message.uid) || serverUids.has(message.uid)) {
      throw new MagniboxSyncError("UIDVALIDITY reconciliation server scan has duplicate or invalid UIDs", false);
    }
    serverUids.add(message.uid);
    if (message.marker !== null) {
      if (!/^mbxop-[0-9a-f-]{36}$/.test(message.marker)) {
        throw new MagniboxSyncError("UIDVALIDITY reconciliation found an invalid operation marker", false);
      }
      const matches = serverByMarker.get(message.marker) ?? [];
      matches.push(message.uid);
      serverByMarker.set(message.marker, matches);
    }
  }

  const knownMarkers = new Set(operationByMarker.keys());
  for (const marker of serverByMarker.keys()) {
    if (!knownMarkers.has(marker)) {
      throw new MagniboxSyncError("UIDVALIDITY reconciliation found an unknown operation marker", false);
    }
    if ((serverByMarker.get(marker) ?? []).length !== 1) {
      throw new MagniboxSyncError("UIDVALIDITY reconciliation found duplicate server operation markers", false);
    }
  }

  const mappingBySource = new Map<string, MagniboxEpochMapping>();
  for (const mapping of input.mappings) {
    if (mappingBySource.has(mapping.sourceMessageId)) {
      throw new MagniboxSyncError("UIDVALIDITY reconciliation found duplicate source mappings", false);
    }
    mappingBySource.set(mapping.sourceMessageId, mapping);
  }

  const rebind: MagniboxEpochReconciliationPlan["rebind"] = [];
  const missing: MagniboxEpochReconciliationPlan["missing"] = [];
  for (const operation of input.operations) {
    const previous = mappingBySource.get(operation.sourceMessageId);
    if (previous && previous.uidValidity !== previousUidValidity) {
      throw new MagniboxSyncError("Stored mapping does not belong to the expected previous epoch", false);
    }
    const uid = serverByMarker.get(operation.marker)?.[0];
    if (uid !== undefined) {
      rebind.push({ sourceMessageId: operation.sourceMessageId, operationId: operation.operationId, uid });
    } else if (operation.state === "confirmed" || previous?.uid !== null && previous?.uid !== undefined) {
      missing.push({ sourceMessageId: operation.sourceMessageId, operationId: operation.operationId });
    }
  }

  const markerUids = new Set(Array.from(serverByMarker.values()).flat());
  return {
    previousUidValidity,
    currentUidValidity,
    rebind,
    missing,
    unmanagedServerUids: input.serverMessages
      .filter(message => !markerUids.has(message.uid))
      .map(message => message.uid),
  };
}
