import { describe, expect, it, vi } from "vitest";
import type { MagniboxSyncOutboxEvent } from "./imap-sync-core";
import {
  createMagniboxInternalMessageImapSyncAdapter,
  type MagniboxInternalMessageProjectionSink,
} from "./internal-message-imap-sync-adapter";
import type { MagniboxInternalMessageResolverRepository } from "./canonical-internal-message-resolver";

const event: MagniboxSyncOutboxEvent = {
  id: "event-1",
  organization_id: "org-1",
  aggregate_type: "internal_message",
  aggregate_id: "message-1",
  event_type: "message.created",
  payload: { sender_mailbox_id: "forged", recipient_mailbox_id: "forged" },
  attempts: 1,
  lease_token: "lease-1",
};

const message = {
  id: "message-1",
  organization_id: "org-1",
  sender_mailbox_id: "mailbox-a",
  recipient_mailbox_id: "mailbox-b",
  subject: "Hello",
  body_text: "Canonical content",
  created_at: "2026-11-20T10:00:00.000Z",
};
const mailbox = (id: string) => ({
  id,
  organization_id: "org-1",
  local_part: id,
  owner_user_id: `owner-${id}`,
  display_name: id,
  is_active: true,
  can_read: true,
});

function makeRepository(): MagniboxInternalMessageResolverRepository {
  return {
    getMessage: vi.fn(async () => message),
    getMailbox: vi.fn(async ({ mailboxId }: { organizationId: string; mailboxId: string }) => mailbox(mailboxId)),
    hasActiveGrants: vi.fn(async () => false),
  };
}

describe("createMagniboxInternalMessageImapSyncAdapter", () => {
  it("applies both participant projections sequentially with mailbox-scoped idempotency keys", async () => {
    const calls: string[] = [];
    const sink: MagniboxInternalMessageProjectionSink = {
      applyMailboxProjection: vi.fn(async ({ idempotencyKey, projection }: Parameters<MagniboxInternalMessageProjectionSink["applyMailboxProjection"]>[0]) => {
        calls.push(idempotencyKey);
        expect(projection.bodyText).toBe("Canonical content");
      }),
    };
    const adapter = createMagniboxInternalMessageImapSyncAdapter(makeRepository(), sink);

    await adapter.apply(event);

    expect(calls).toEqual([
      "event-1:mailbox-a",
      "event-1:mailbox-b",
    ]);
    expect(sink.applyMailboxProjection).toHaveBeenCalledTimes(2);
  });

  it("propagates a participant failure so the outbox event is not acknowledged", async () => {
    const sink: MagniboxInternalMessageProjectionSink = {
      applyMailboxProjection: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("temporary IMAP failure")),
    };
    const adapter = createMagniboxInternalMessageImapSyncAdapter(makeRepository(), sink);

    await expect(adapter.apply(event)).rejects.toThrow("temporary IMAP failure");
    expect(sink.applyMailboxProjection).toHaveBeenCalledTimes(2);
  });

  it("fails closed for external messages rather than acknowledging an unsupported event", async () => {
    const sink: MagniboxInternalMessageProjectionSink = {
      applyMailboxProjection: vi.fn(),
    };
    const adapter = createMagniboxInternalMessageImapSyncAdapter(makeRepository(), sink);

    await expect(adapter.apply({
      ...event,
      aggregate_type: "external_message",
    })).rejects.toMatchObject({
      name: "MagniboxSyncError",
      retryable: false,
    });
    expect(sink.applyMailboxProjection).not.toHaveBeenCalled();
  });
});
