import { describe, expect, it, vi } from "vitest";
import { MagniboxSyncError } from "./imap-sync-core";
import {
  createMagniboxSupabaseImapAppendLedgerRepository,
  type MagniboxImapAppendRpcClient,
} from "./imap-append-supabase-repository";

const base = {
  organizationId: "org-1",
  outboxEventId: "event-1",
  leaseToken: "lease-1",
  targetMailboxId: "mailbox-1",
  folderStateId: "folder-1",
};
const row = {
  operation_id: "operation-1",
  marker: "mbxop-123e4567-e89b-12d3-a456-426614174000",
  operation_state: "ready",
  uidvalidity: "42",
  imap_uid: null,
};

function client(responses: unknown[]): MagniboxImapAppendRpcClient & { rpc: ReturnType<typeof vi.fn> } {
  return { rpc: vi.fn(async () => ({ data: responses.shift(), error: null })) };
}

describe("durable IMAP APPEND ledger Supabase repository", () => {
  it("loads the stable database-generated marker and exact operation scope", async () => {
    const rpc = client([[row]]);
    const repository = createMagniboxSupabaseImapAppendLedgerRepository(rpc);
    await expect(repository.getOrCreate(base)).resolves.toMatchObject({
      operationId: "operation-1",
      marker: row.marker,
      state: "ready",
      uidValidity: "42",
      uid: null,
    });
    expect(rpc.rpc).toHaveBeenCalledWith("magnibox_get_or_create_imap_append_operation", {
      p_organization_id: "org-1",
      p_outbox_event_id: "event-1",
      p_lease_token: "lease-1",
      p_target_mailbox_id: "mailbox-1",
      p_folder_state_id: "folder-1",
    });
  });

  it("uses lease-fenced RPCs for the irreversible start and ambiguous outcome", async () => {
    const rpc = client(["append_started", "ambiguous"]);
    const repository = createMagniboxSupabaseImapAppendLedgerRepository(rpc);
    await expect(repository.markStarted({
      organizationId: "org-1", outboxEventId: "event-1",
      leaseToken: "lease-1", operationId: "operation-1",
    })).resolves.toBe("append_started");
    await expect(repository.markAmbiguous({
      organizationId: "org-1", outboxEventId: "event-1",
      leaseToken: "lease-1", operationId: "operation-1",
    })).resolves.toBe("ambiguous");
    expect(rpc.rpc.mock.calls.map(call => call[0])).toEqual([
      "magnibox_mark_imap_append_started",
      "magnibox_mark_imap_append_ambiguous",
    ]);
  });

  it("preserves UID and UIDVALIDITY values beyond JavaScript safe integers", async () => {
    const rpc = client([[
      { ...row, operation_state: "confirmed", uidvalidity: "9223372036854775807", imap_uid: "9007199254740993" },
    ]]);
    const repository = createMagniboxSupabaseImapAppendLedgerRepository(rpc);
    await expect(repository.confirm({
      organizationId: "org-1", outboxEventId: "event-1",
      leaseToken: "lease-1", operationId: "operation-1",
      uidValidity: "9223372036854775807", uid: "9007199254740993",
    })).resolves.toMatchObject({
      state: "confirmed",
      uidValidity: "9223372036854775807",
      uid: "9007199254740993",
    });
  });

  it("rejects unsafe UID values before calling Supabase", async () => {
    const rpc = client([]);
    const repository = createMagniboxSupabaseImapAppendLedgerRepository(rpc);
    await expect(repository.confirm({
      organizationId: "org-1", outboxEventId: "event-1",
      leaseToken: "lease-1", operationId: "operation-1",
      uidValidity: "42", uid: "9007199254740992.5",
    })).rejects.toBeInstanceOf(MagniboxSyncError);
    expect(rpc.rpc).not.toHaveBeenCalled();
  });

  it("fails closed on malformed or duplicate RPC rows", async () => {
    const repository = createMagniboxSupabaseImapAppendLedgerRepository(client([]));
    await expect(repository.getOrCreate(base)).rejects.toBeInstanceOf(MagniboxSyncError);
  });

  it("hides raw database diagnostics", async () => {
    const rpc: MagniboxImapAppendRpcClient = {
      rpc: vi.fn(async () => ({ data: null, error: { message: "private SQL detail" } })),
    };
    const repository = createMagniboxSupabaseImapAppendLedgerRepository(rpc);
    await expect(repository.markStarted({
      organizationId: "org-1", outboxEventId: "event-1",
      leaseToken: "lease-1", operationId: "operation-1",
    })).rejects.toThrow("IMAP APPEND ledger operation failed");
    await expect(repository.markStarted({
      organizationId: "org-1", outboxEventId: "event-1",
      leaseToken: "lease-1", operationId: "operation-1",
    })).rejects.not.toThrow("private SQL detail");
  });
  it("reads bounded recovery inventory and canonicalizes epoch values", async () => {
    const rpc = client([[
      {
        operation_id: "op-1",
        outbox_event_id: "event-1",
        source_message_id: "message-1",
        marker: row.marker,
        operation_state: "ambiguous",
        operation_uidvalidity: "00042",
        imap_uid: null,
        created_at: "2026-11-21T10:00:00.000Z",
      },
    ]]);
    const repository = createMagniboxSupabaseImapAppendLedgerRepository(rpc);
    await expect(repository.listRecoveryInventory({
      organizationId: "org-1",
      folderStateId: "folder-1",
      currentUidValidity: "42",
      afterOperationId: "op-cursor",
      limit: 25,
    })).resolves.toEqual([{
      operationId: "op-1",
      outboxEventId: "event-1",
      sourceMessageId: "message-1",
      marker: row.marker,
      state: "ambiguous",
      operationUidValidity: "42",
      uid: null,
      createdAt: "2026-11-21T10:00:00.000Z",
    }]);
    expect(rpc.rpc).toHaveBeenCalledWith("magnibox_list_imap_append_recovery", {
      p_organization_id: "org-1",
      p_folder_state_id: "folder-1",
      p_current_uidvalidity: "42",
      p_after_operation_id: "op-cursor",
      p_limit: 25,
    });
  });

  it("rejects invalid recovery page limits before calling Supabase", async () => {
    const rpc = client([]);
    const repository = createMagniboxSupabaseImapAppendLedgerRepository(rpc);
    await expect(repository.listRecoveryInventory({
      organizationId: "org-1",
      folderStateId: "folder-1",
      currentUidValidity: "42",
      limit: 501,
    })).rejects.toBeInstanceOf(MagniboxSyncError);
    expect(rpc.rpc).not.toHaveBeenCalled();
  });

});
