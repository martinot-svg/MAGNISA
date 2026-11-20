import { describe, expect, it, vi } from "vitest";
import { MagniboxSyncError } from "./imap-sync-core";
import {
  createMagniboxSupabaseImapMappingRepository,
  type MagniboxImapMappingRpcClient,
} from "./imap-mapping-supabase-repository";

function client(responses: unknown[]): MagniboxImapMappingRpcClient & { rpc: ReturnType<typeof vi.fn> } {
  return { rpc: vi.fn(async () => ({ data: responses.shift(), error: null })) };
}
const scope = {
  organizationId: "org-1",
  sourceType: "internal_message" as const,
  sourceMessageId: "message-1",
  folderStateId: "folder-1",
};
const mappingRow = {
  mapping_id: "map-1",
  organization_id: "org-1",
  source_type: "internal_message",
  source_message_id: "message-1",
  folder_state_id: "folder-1",
  uidvalidity: "42",
  imap_uid: "9007199254740993",
  imap_modseq: "0",
  imap_flags: ["\\Seen"],
  sync_version: "2",
  deleted_at: null,
  delete_event_id: null,
  delete_confirmed_at: null,
};

describe("createMagniboxSupabaseImapMappingRepository", () => {
  it("loads a mapping with exact organization/source/folder scope", async () => {
    const rpc = client([[mappingRow]]);
    const repository = createMagniboxSupabaseImapMappingRepository(rpc);
    await expect(repository.get(scope)).resolves.toMatchObject({
      mappingId: "map-1",
      uidValidity: "42",
      uid: "9007199254740993",
      syncVersion: "2",
    });
    expect(rpc.rpc).toHaveBeenCalledWith("magnibox_get_imap_message_mapping", {
      p_organization_id: "org-1",
      p_source_type: "internal_message",
      p_source_message_id: "message-1",
      p_folder_state_id: "folder-1",
    });
  });

  it("returns null when no mapping exists", async () => {
    const repository = createMagniboxSupabaseImapMappingRepository(client([[]]));
    await expect(repository.get(scope)).resolves.toBeNull();
  });

  it("records only a confirmed UID and passes explicit previous epoch for reconciliation", async () => {
    const rpc = client([[{ mapping_id: "map-1", sync_version: "3", result: "reconciled" }]]);
    const repository = createMagniboxSupabaseImapMappingRepository(rpc);
    await expect(repository.recordConfirmedUid({
      ...scope,
      uidValidity: "43",
      uid: "91",
      expectedPreviousUidValidity: "42",
      modseq: "0",
      flags: ["\\Seen"],
    })).resolves.toEqual({ mappingId: "map-1", syncVersion: "3", result: "reconciled" });
    expect(rpc.rpc).toHaveBeenCalledWith("magnibox_record_imap_message_uid", expect.objectContaining({
      p_uidvalidity: "43",
      p_imap_uid: "91",
      p_expected_previous_uidvalidity: "42",
      p_imap_modseq: "0",
    }));
  });

  it("rejects unsafe BIGINT values before invoking the database", async () => {
    const rpc = client([]);
    const repository = createMagniboxSupabaseImapMappingRepository(rpc);
    await expect(repository.recordConfirmedUid({
      ...scope,
      uidValidity: "42",
      uid: "9007199254740992.5",
    })).rejects.toBeInstanceOf(MagniboxSyncError);
    expect(rpc.rpc).not.toHaveBeenCalled();
  });

  it("tombstones with a stable delete event ID", async () => {
    const rpc = client([true]);
    const repository = createMagniboxSupabaseImapMappingRepository(rpc);
    await expect(repository.tombstone(scope, "delete-event-1")).resolves.toBe(true);
    expect(rpc.rpc).toHaveBeenCalledWith("magnibox_tombstone_imap_message_mapping", {
      p_organization_id: "org-1",
      p_source_type: "internal_message",
      p_source_message_id: "message-1",
      p_folder_state_id: "folder-1",
      p_delete_event_id: "delete-event-1",
    });
  });

  it("hides raw SQL error details behind a retryable sync error", async () => {
    const rpc: MagniboxImapMappingRpcClient = {
      rpc: vi.fn(async () => ({ data: null, error: { message: "secret database diagnostic" } })),
    };
    const repository = createMagniboxSupabaseImapMappingRepository(rpc);
    await expect(repository.get(scope)).rejects.toThrow("IMAP mapping operation");
    await expect(repository.get(scope)).rejects.not.toThrow("secret database diagnostic");
  });
});
