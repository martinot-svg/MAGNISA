import { describe, expect, it, vi } from "vitest";
import { MagniboxSyncError, type MagniboxSyncOutboxEvent } from "./imap-sync-core";
import {
  resolveMagniboxInternalMessage,
  type MagniboxInternalMessageResolverRepository,
} from "./canonical-internal-message-resolver";

const event: MagniboxSyncOutboxEvent = {
  id: "event-1",
  organization_id: "org-1",
  aggregate_type: "internal_message",
  aggregate_id: "message-1",
  event_type: "message.created",
  payload: { message_id: "untrusted-payload-id", body_text: "untrusted body" },
  attempts: 1,
  lease_token: "lease-1",
};

const message = {
  id: "message-1",
  organization_id: "org-1",
  sender_mailbox_id: "mailbox-sender",
  recipient_mailbox_id: "mailbox-recipient",
  subject: "Project update",
  body_text: "Canonical body from Supabase",
  created_at: "2026-11-20T10:00:00.000Z",
};

const sender = {
  id: "mailbox-sender",
  organization_id: "org-1",
  local_part: "alice",
  owner_user_id: "user-alice",
  display_name: "Alice",
  is_active: true,
  can_read: true,
};

const recipient = {
  id: "mailbox-recipient",
  organization_id: "org-1",
  local_part: "finance",
  owner_user_id: "user-finance",
  display_name: "Finance",
  is_active: true,
  can_read: true,
};

function repository(
  overrides: Partial<MagniboxInternalMessageResolverRepository> = {},
): MagniboxInternalMessageResolverRepository {
  return {
    getMessage: vi.fn(async () => message),
    getMailbox: vi.fn(async ({ mailboxId }) =>
      mailboxId === sender.id ? sender : mailboxId === recipient.id ? recipient : null
    ),
    hasActiveGrants: vi.fn(async () => false),
    ...overrides,
  };
}

async function expectPermanentFailure(promise: Promise<unknown>, messagePart: string) {
  await expect(promise).rejects.toMatchObject({
    name: "MagniboxSyncError",
    retryable: false,
    message: expect.stringContaining(messagePart),
  } satisfies Partial<MagniboxSyncError>);
}

describe("resolveMagniboxInternalMessage", () => {
  it("resolves canonical content for an individual recipient mailbox", async () => {
    const repo = repository();
    const result = await resolveMagniboxInternalMessage(repo, {
      event,
      targetMailboxId: recipient.id,
    });

    expect(result).toEqual({
      kind: "internal",
      organizationId: "org-1",
      sourceMessageId: "message-1",
      targetMailboxId: recipient.id,
      targetRole: "recipient",
      sender: { mailboxId: sender.id, localPart: "alice", displayName: "Alice" },
      recipient: { mailboxId: recipient.id, localPart: "finance", displayName: "Finance" },
      subject: "Project update",
      bodyText: "Canonical body from Supabase",
      createdAt: message.created_at,
    });
    expect(repo.getMessage).toHaveBeenCalledWith({
      organizationId: "org-1",
      messageId: "message-1",
    });
  });

  it("does not trust message IDs or body fields copied into the outbox payload", async () => {
    const repo = repository();
    const result = await resolveMagniboxInternalMessage(repo, {
      event,
      targetMailboxId: sender.id,
    });
    expect(result.sourceMessageId).toBe("message-1");
    expect(result.bodyText).toBe("Canonical body from Supabase");
    expect(repo.getMessage).toHaveBeenCalledWith({
      organizationId: "org-1",
      messageId: "message-1",
    });
  });

  it("rejects cross-organization canonical rows", async () => {
    const repo = repository({
      getMessage: vi.fn(async () => ({ ...message, organization_id: "org-2" })),
    });
    await expectPermanentFailure(
      resolveMagniboxInternalMessage(repo, { event, targetMailboxId: recipient.id }),
      "failed validation",
    );
  });

  it("rejects a mailbox that is not a message participant", async () => {
    const repo = repository();
    await expectPermanentFailure(
      resolveMagniboxInternalMessage(repo, { event, targetMailboxId: "mailbox-other" }),
      "not a participant",
    );
  });

  it("rejects inactive or unreadable mailboxes", async () => {
    const repo = repository({
      getMailbox: vi.fn(async ({ mailboxId }) =>
        mailboxId === recipient.id ? { ...recipient, is_active: false } : sender
      ),
    });
    await expectPermanentFailure(
      resolveMagniboxInternalMessage(repo, { event, targetMailboxId: recipient.id }),
      "active individual readable",
    );
  });

  it("rejects mailboxes with active shared grants in the individual pilot", async () => {
    const repo = repository({
      hasActiveGrants: vi.fn(async () => true),
    });
    await expectPermanentFailure(
      resolveMagniboxInternalMessage(repo, { event, targetMailboxId: recipient.id }),
      "excluded from the first IMAP pilot",
    );
  });

  it("rejects unsupported source and event types without querying content", async () => {
    const repo = repository();
    await expectPermanentFailure(
      resolveMagniboxInternalMessage(repo, {
        event: { ...event, aggregate_type: "external_message" },
        targetMailboxId: recipient.id,
      }),
      "Unsupported MAGNIBOX source type",
    );
    expect(repo.getMessage).not.toHaveBeenCalled();
  });

  it("rejects deletion events because deletes must use durable mapping tombstones", async () => {
    const repo = repository();
    await expectPermanentFailure(
      resolveMagniboxInternalMessage(repo, {
        event: { ...event, event_type: "message.deleted" },
        targetMailboxId: recipient.id,
      }),
      "Unsupported event",
    );
    expect(repo.getMessage).not.toHaveBeenCalled();
  });

  it("rejects a peer mailbox outside the organization", async () => {
    const repo = repository({
      getMailbox: vi.fn(async ({ mailboxId }) =>
        mailboxId === recipient.id
          ? recipient
          : { ...sender, organization_id: "org-2" }
      ),
    });
    await expectPermanentFailure(
      resolveMagniboxInternalMessage(repo, { event, targetMailboxId: recipient.id }),
      "Peer mailbox is missing",
    );
  });
});
