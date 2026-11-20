import { describe, expect, it, vi } from "vitest";
import { MagniboxSyncError } from "./imap-sync-core";
import {
  createMagniboxSupabaseInternalMessageResolverRepository,
  type MagniboxResolverSupabaseClient,
} from "./canonical-internal-message-supabase-repository";

function clientWithRows(rows: Record<string, unknown | null>) {
  const calls: Array<{ table: string; filters: Array<[string, string | boolean]>; columns?: string }> = [];
  const client: MagniboxResolverSupabaseClient = {
    from(table) {
      const call = { table, filters: [] as Array<[string, string | boolean]>, columns: undefined as string | undefined };
      calls.push(call);
      const query = {
        select(columns: string) { call.columns = columns; return query; },
        eq(column: string, value: string | boolean) { call.filters.push([column, value]); return query; },
        limit() { return query; },
        maybeSingle() { return Promise.resolve({ data: rows[table] ?? null, error: null }); },
      };
      return query;
    },
  };
  return { client, calls };
}

const messageRow = {
  id: "message-1",
  organization_id: "org-1",
  sender_mailbox_id: "sender-1",
  recipient_mailbox_id: "recipient-1",
  subject: "Hello",
  body_text: "Canonical body",
  created_at: "2026-11-20T10:00:00.000Z",
};

const mailboxRow = {
  id: "recipient-1",
  organization_id: "org-1",
  local_part: "finance",
  owner_user_id: "user-1",
  display_name: "Finance",
  is_active: true,
  can_read: true,
};

describe("createMagniboxSupabaseInternalMessageResolverRepository", () => {
  it("scopes canonical message and mailbox queries by organization and ID", async () => {
    const { client, calls } = clientWithRows({
      mgmail_internal_messages: messageRow,
      mgmail_internal_mailboxes: mailboxRow,
    });
    const repository = createMagniboxSupabaseInternalMessageResolverRepository(client);

    await expect(repository.getMessage({ organizationId: "org-1", messageId: "message-1" }))
      .resolves.toEqual(messageRow);
    await expect(repository.getMailbox({ organizationId: "org-1", mailboxId: "recipient-1" }))
      .resolves.toEqual(mailboxRow);

    expect(calls[0]).toMatchObject({
      table: "mgmail_internal_messages",
      filters: [["organization_id", "org-1"], ["id", "message-1"]],
    });
    expect(calls[1]).toMatchObject({
      table: "mgmail_internal_mailboxes",
      filters: [["organization_id", "org-1"], ["id", "recipient-1"]],
    });
  });

  it("checks only active grants for the exact organization and mailbox", async () => {
    const { client, calls } = clientWithRows({
      mgmail_internal_mailbox_grants: { mailbox_id: "recipient-1" },
    });
    const repository = createMagniboxSupabaseInternalMessageResolverRepository(client);

    await expect(repository.hasActiveGrants({ organizationId: "org-1", mailboxId: "recipient-1" }))
      .resolves.toBe(true);
    expect(calls[0]).toMatchObject({
      table: "mgmail_internal_mailbox_grants",
      filters: [
        ["organization_id", "org-1"],
        ["mailbox_id", "recipient-1"],
        ["is_active", true],
      ],
    });
  });

  it("returns false when no active grants exist", async () => {
    const { client } = clientWithRows({});
    const repository = createMagniboxSupabaseInternalMessageResolverRepository(client);
    await expect(repository.hasActiveGrants({ organizationId: "org-1", mailboxId: "recipient-1" }))
      .resolves.toBe(false);
  });

  it("maps database errors to retryable generic sync errors", async () => {
    const client: MagniboxResolverSupabaseClient = {
      from() {
        const query = {
          select() { return query; },
          eq() { return query; },
          limit() { return query; },
          maybeSingle: vi.fn(async () => ({ data: null, error: { message: "sensitive SQL detail" } })),
        };
        return query;
      },
    };
    const repository = createMagniboxSupabaseInternalMessageResolverRepository(client);
    await expect(repository.getMessage({ organizationId: "org-1", messageId: "message-1" }))
      .rejects.toMatchObject({
        name: "MagniboxSyncError",
        retryable: true,
        message: "Canonical message lookup failed",
      });
    await expect(repository.getMessage({ organizationId: "org-1", messageId: "message-1" }))
      .rejects.not.toThrow("sensitive SQL detail");
  });

  it("rejects malformed database rows without echoing their content", async () => {
    const { client } = clientWithRows({
      mgmail_internal_messages: { ...messageRow, subject: null },
    });
    const repository = createMagniboxSupabaseInternalMessageResolverRepository(client);
    await expect(repository.getMessage({ organizationId: "org-1", messageId: "message-1" }))
      .rejects.toBeInstanceOf(MagniboxSyncError);
  });
});
