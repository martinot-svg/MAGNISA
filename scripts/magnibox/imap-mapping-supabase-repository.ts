import { MagniboxSyncError } from "./imap-sync-core";
import { canonicalPositiveBigint } from "./imap-uid-mapping";

type RpcResult = { data: unknown; error: { message?: string } | null };
export interface MagniboxImapMappingRpcClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<RpcResult>;
}

export type MagniboxImapMessageMappingRecord = {
  mappingId: string;
  organizationId: string;
  sourceType: "internal_message" | "external_message";
  sourceMessageId: string;
  folderStateId: string;
  uidValidity: string;
  uid: string | null;
  modseq: string | null;
  flags: string[];
  syncVersion: string;
  deletedAt: string | null;
  deleteEventId: string | null;
  deleteConfirmedAt: string | null;
};

export type MagniboxImapMappingScope = {
  organizationId: string;
  sourceType: "internal_message" | "external_message";
  sourceMessageId: string;
  folderStateId: string;
};

export type MagniboxRecordConfirmedUidInput = MagniboxImapMappingScope & {
  uidValidity: string;
  uid: string;
  expectedPreviousUidValidity?: string;
  modseq?: string | null;
  flags?: string[];
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MagniboxSyncError("Invalid IMAP mapping RPC response", false);
  }
  return value as Record<string, unknown>;
}
function requiredText(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new MagniboxSyncError("Invalid IMAP mapping RPC response", false);
  }
  return value;
}
function nullableText(row: Record<string, unknown>, field: string): string | null {
  const value = row[field];
  if (value === null) return null;
  if (typeof value !== "string" || value.length === 0) {
    throw new MagniboxSyncError("Invalid IMAP mapping RPC response", false);
  }
  return value;
}
function mapMapping(value: unknown): MagniboxImapMessageMappingRecord {
  const row = asRecord(value);
  const sourceType = requiredText(row, "source_type");
  if (sourceType !== "internal_message" && sourceType !== "external_message") {
    throw new MagniboxSyncError("Invalid IMAP mapping source type", false);
  }
  const flags = row.imap_flags;
  if (!Array.isArray(flags) || flags.some(flag => typeof flag !== "string")) {
    throw new MagniboxSyncError("Invalid IMAP mapping flags", false);
  }
  const uid = nullableText(row, "imap_uid");
  const modseq = nullableText(row, "imap_modseq");
  const deleteEventId = nullableText(row, "delete_event_id");
  return {
    mappingId: requiredText(row, "mapping_id"),
    organizationId: requiredText(row, "organization_id"),
    sourceType,
    sourceMessageId: requiredText(row, "source_message_id"),
    folderStateId: requiredText(row, "folder_state_id"),
    uidValidity: canonicalPositiveBigint(requiredText(row, "uidvalidity"), "UIDVALIDITY"),
    uid: uid === null ? null : canonicalPositiveBigint(uid, "UID"),
    modseq: modseq === null ? null : canonicalPositiveBigint(modseq, "MODSEQ"),
    flags: flags as string[],
    syncVersion: canonicalPositiveBigint(requiredText(row, "sync_version"), "sync version"),
    deletedAt: nullableText(row, "deleted_at"),
    deleteEventId,
    deleteConfirmedAt: nullableText(row, "delete_confirmed_at"),
  };
}

async function callRpc(
  client: MagniboxImapMappingRpcClient,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const result = await client.rpc(name, args);
  if (result.error) {
    // Never leak raw SQL diagnostics into worker logs.
    throw new MagniboxSyncError(`IMAP mapping operation ${name} failed`);
  }
  return result.data;
}

/** Server-only adapter; construct with a service-role Supabase client. */
export function createMagniboxSupabaseImapMappingRepository(
  client: MagniboxImapMappingRpcClient,
) {
  return {
    async get(scope: MagniboxImapMappingScope): Promise<MagniboxImapMessageMappingRecord | null> {
      const data = await callRpc(client, "magnibox_get_imap_message_mapping", {
        p_organization_id: scope.organizationId,
        p_source_type: scope.sourceType,
        p_source_message_id: scope.sourceMessageId,
        p_folder_state_id: scope.folderStateId,
      });
      if (!Array.isArray(data) || data.length > 1) {
        throw new MagniboxSyncError("IMAP mapping lookup returned an invalid result", false);
      }
      return data.length === 0 ? null : mapMapping(data[0]);
    },

    async recordConfirmedUid(input: MagniboxRecordConfirmedUidInput): Promise<{
      mappingId: string;
      syncVersion: string;
      result: "inserted" | "already_recorded" | "reconciled";
    }> {
      const uidValidity = canonicalPositiveBigint(input.uidValidity, "UIDVALIDITY");
      const uid = canonicalPositiveBigint(input.uid, "UID");
      const modseq = input.modseq == null ? null : canonicalPositiveBigint(input.modseq, "MODSEQ");
      const previous = input.expectedPreviousUidValidity == null
        ? null
        : canonicalPositiveBigint(input.expectedPreviousUidValidity, "previous UIDVALIDITY");
      const flags = input.flags ?? [];
      if (!Array.isArray(flags) || flags.some(flag => typeof flag !== "string")) {
        throw new MagniboxSyncError("Invalid IMAP flags", false);
      }
      const data = await callRpc(client, "magnibox_record_imap_message_uid", {
        p_organization_id: input.organizationId,
        p_source_type: input.sourceType,
        p_source_message_id: input.sourceMessageId,
        p_folder_state_id: input.folderStateId,
        p_uidvalidity: uidValidity,
        p_imap_uid: uid,
        p_expected_previous_uidvalidity: previous,
        p_imap_modseq: modseq,
        p_imap_flags: flags,
      });
      if (!Array.isArray(data) || data.length !== 1) {
        throw new MagniboxSyncError("IMAP mapping write returned an invalid result", false);
      }
      const row = asRecord(data[0]);
      const result = requiredText(row, "result");
      if (result !== "inserted" && result !== "already_recorded" && result !== "reconciled") {
        throw new MagniboxSyncError("Unknown IMAP mapping write result", false);
      }
      return {
        mappingId: requiredText(row, "mapping_id"),
        syncVersion: canonicalPositiveBigint(requiredText(row, "sync_version"), "sync version"),
        result,
      };
    },

    async tombstone(scope: MagniboxImapMappingScope, deleteEventId: string): Promise<boolean> {
      if (!deleteEventId.trim()) throw new MagniboxSyncError("Delete event ID is required", false);
      const data = await callRpc(client, "magnibox_tombstone_imap_message_mapping", {
        p_organization_id: scope.organizationId,
        p_source_type: scope.sourceType,
        p_source_message_id: scope.sourceMessageId,
        p_folder_state_id: scope.folderStateId,
        p_delete_event_id: deleteEventId,
      });
      if (typeof data !== "boolean") {
        throw new MagniboxSyncError("IMAP tombstone RPC returned a non-boolean result", false);
      }
      return data;
    },
  };
}
