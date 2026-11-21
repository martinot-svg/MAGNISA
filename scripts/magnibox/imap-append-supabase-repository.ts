import { canonicalPositiveBigint } from "./imap-uid-mapping";
import { MagniboxSyncError } from "./imap-sync-core";

type RpcResult = { data: unknown; error: { message?: string } | null };
export interface MagniboxImapAppendRpcClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<RpcResult>;
}

export type MagniboxAppendOperationState =
  | "ready"
  | "append_started"
  | "ambiguous"
  | "confirmed";

export type MagniboxAppendOperation = {
  operationId: string;
  marker: string;
  state: MagniboxAppendOperationState;
  uidValidity: string;
  uid: string | null;
};

export type MagniboxAppendRecoveryItem = {
  operationId: string;
  outboxEventId: string;
  sourceMessageId: string;
  marker: string;
  state: MagniboxAppendOperationState;
  operationUidValidity: string;
  uid: string | null;
  createdAt: string;
};

export interface MagniboxImapAppendLedgerRepository {
  listRecoveryInventory(input: {
    organizationId: string;
    folderStateId: string;
    currentUidValidity: string;
    afterOperationId?: string | null;
    limit?: number;
  }): Promise<MagniboxAppendRecoveryItem[]>;

  getOrCreate(input: {
    organizationId: string;
    outboxEventId: string;
    leaseToken: string;
    targetMailboxId: string;
    folderStateId: string;
  }): Promise<MagniboxAppendOperation>;
  markStarted(input: {
    organizationId: string;
    outboxEventId: string;
    leaseToken: string;
    operationId: string;
  }): Promise<MagniboxAppendOperationState>;
  markAmbiguous(input: {
    organizationId: string;
    outboxEventId: string;
    leaseToken: string;
    operationId: string;
  }): Promise<MagniboxAppendOperationState>;
  confirm(input: {
    organizationId: string;
    outboxEventId: string;
    leaseToken: string;
    operationId: string;
    uidValidity: string;
    uid: string;
  }): Promise<MagniboxAppendOperation>;
}

const STATES = new Set<MagniboxAppendOperationState>([
  "ready", "append_started", "ambiguous", "confirmed",
]);

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MagniboxSyncError("Invalid IMAP APPEND ledger response", false);
  }
  return value as Record<string, unknown>;
}

function requiredString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new MagniboxSyncError("Invalid IMAP APPEND ledger response", false);
  }
  return value;
}

function mapOperation(value: unknown): MagniboxAppendOperation {
  const row = record(value);
  const state = requiredString(row, "operation_state");
  const marker = requiredString(row, "marker");
  if (!STATES.has(state as MagniboxAppendOperationState)
    || !/^mbxop-[0-9a-f-]{36}$/.test(marker)) {
    throw new MagniboxSyncError("Invalid IMAP APPEND ledger response", false);
  }
  const uidValidity = canonicalPositiveBigint(requiredString(row, "uidvalidity"), "UIDVALIDITY");
  const rawUid = row.imap_uid;
  const uid = rawUid === null
    ? null
    : canonicalPositiveBigint(typeof rawUid === "string" ? rawUid : "", "UID");
  if ((state === "confirmed") !== (uid !== null)) {
    throw new MagniboxSyncError("Invalid IMAP APPEND confirmation mapping", false);
  }
  return {
    operationId: requiredString(row, "operation_id"),
    marker,
    state: state as MagniboxAppendOperationState,
    uidValidity,
    uid,
  };
}

function mapState(value: unknown): MagniboxAppendOperationState {
  if (typeof value !== "string" || !STATES.has(value as MagniboxAppendOperationState)) {
    throw new MagniboxSyncError("Invalid IMAP APPEND ledger state", false);
  }
  return value as MagniboxAppendOperationState;
}

async function call(
  client: MagniboxImapAppendRpcClient,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const result = await client.rpc(name, args);
  if (result.error) throw new MagniboxSyncError("IMAP APPEND ledger operation failed");
  return result.data;
}

function firstRow(data: unknown): unknown {
  if (!Array.isArray(data) || data.length !== 1) {
    throw new MagniboxSyncError("IMAP APPEND ledger RPC returned an invalid row set", false);
  }
  return data[0];
}

/** Server-only adapter for the lease-fenced durable APPEND operation ledger. */
export function createMagniboxSupabaseImapAppendLedgerRepository(
  client: MagniboxImapAppendRpcClient,
): MagniboxImapAppendLedgerRepository {
  return {
    async listRecoveryInventory(input) {
      const limit = input.limit ?? 100;
      if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
        throw new MagniboxSyncError("Invalid IMAP recovery inventory limit", false);
      }
      const currentUidValidity = canonicalPositiveBigint(
        input.currentUidValidity, "UIDVALIDITY",
      );
      const data = await call(client, "magnibox_list_imap_append_recovery", {
        p_organization_id: input.organizationId,
        p_folder_state_id: input.folderStateId,
        p_current_uidvalidity: currentUidValidity,
        p_after_operation_id: input.afterOperationId ?? null,
        p_limit: limit,
      });
      if (!Array.isArray(data) || data.length > limit) {
        throw new MagniboxSyncError("Invalid IMAP recovery inventory response", false);
      }
      return data.map(value => {
        const row = record(value);
        const state = mapState(row.operation_state);
        const marker = requiredString(row, "marker");
        if (!/^mbxop-[0-9a-f-]{36}$/.test(marker)) {
          throw new MagniboxSyncError("Invalid IMAP recovery marker", false);
        }
        const rawUid = row.imap_uid;
        const uid = rawUid === null
          ? null
          : canonicalPositiveBigint(typeof rawUid === "string" ? rawUid : "", "UID");
        const operationUidValidity = canonicalPositiveBigint(
          requiredString(row, "operation_uidvalidity"), "UIDVALIDITY",
        );
        const createdAt = requiredString(row, "created_at");
        if (!Number.isFinite(Date.parse(createdAt))
          || (state === "confirmed") !== (uid !== null)) {
          throw new MagniboxSyncError("Invalid IMAP recovery inventory row", false);
        }
        return {
          operationId: requiredString(row, "operation_id"),
          outboxEventId: requiredString(row, "outbox_event_id"),
          sourceMessageId: requiredString(row, "source_message_id"),
          marker,
          state,
          operationUidValidity,
          uid,
          createdAt,
        };
      });
    },
    async getOrCreate(input) {
      const data = await call(client, "magnibox_get_or_create_imap_append_operation", {
        p_organization_id: input.organizationId,
        p_outbox_event_id: input.outboxEventId,
        p_lease_token: input.leaseToken,
        p_target_mailbox_id: input.targetMailboxId,
        p_folder_state_id: input.folderStateId,
      });
      return mapOperation(firstRow(data));
    },
    async markStarted(input) {
      return mapState(await call(client, "magnibox_mark_imap_append_started", {
        p_organization_id: input.organizationId,
        p_outbox_event_id: input.outboxEventId,
        p_lease_token: input.leaseToken,
        p_operation_id: input.operationId,
      }));
    },
    async markAmbiguous(input) {
      return mapState(await call(client, "magnibox_mark_imap_append_ambiguous", {
        p_organization_id: input.organizationId,
        p_outbox_event_id: input.outboxEventId,
        p_lease_token: input.leaseToken,
        p_operation_id: input.operationId,
      }));
    },
    async confirm(input) {
      const uidValidity = canonicalPositiveBigint(input.uidValidity, "UIDVALIDITY");
      const uid = canonicalPositiveBigint(input.uid, "UID");
      const data = await call(client, "magnibox_confirm_imap_append", {
        p_organization_id: input.organizationId,
        p_outbox_event_id: input.outboxEventId,
        p_lease_token: input.leaseToken,
        p_operation_id: input.operationId,
        p_uidvalidity: uidValidity,
        p_imap_uid: uid,
      });
      return mapOperation(firstRow(data));
    },
  };
}
