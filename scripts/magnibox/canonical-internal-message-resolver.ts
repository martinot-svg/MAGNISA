import { MagniboxSyncError, type MagniboxSyncOutboxEvent } from "./imap-sync-core";

/**
 * Canonical rows are deliberately narrow projections of the Supabase schema.
 * The repository implementation must query using every supplied scope field;
 * it must not trust event.payload for canonical content or mailbox selection.
 */
export type MagniboxInternalMessageRow = {
  id: string;
  organization_id: string;
  sender_mailbox_id: string;
  recipient_mailbox_id: string;
  subject: string;
  body_text: string;
  created_at: string;
};

export type MagniboxInternalMailboxRow = {
  id: string;
  organization_id: string;
  local_part: string;
  owner_user_id: string | null;
  display_name: string;
  is_active: boolean;
  can_read: boolean;
};

export interface MagniboxInternalMessageResolverRepository {
  getMessage(input: {
    organizationId: string;
    messageId: string;
  }): Promise<MagniboxInternalMessageRow | null>;
  getMailbox(input: {
    organizationId: string;
    mailboxId: string;
  }): Promise<MagniboxInternalMailboxRow | null>;
  hasActiveGrants(input: {
    organizationId: string;
    mailboxId: string;
  }): Promise<boolean>;
}

export type MagniboxResolvedInternalMessage = {
  kind: "internal";
  organizationId: string;
  sourceMessageId: string;
  targetMailboxId: string;
  targetRole: "sender" | "recipient";
  sender: { mailboxId: string; localPart: string; displayName: string };
  recipient: { mailboxId: string; localPart: string; displayName: string };
  subject: string;
  bodyText: string;
  createdAt: string;
};

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

/**
 * Resolves only individual, active MAGNIBOX mailboxes for the first IMAP pilot.
 *
 * Supported events are create/update. Delete is handled from the durable IMAP
 * mapping/tombstone, because the canonical source row may already be gone.
 * Shared mailboxes, personal flags/folders, Internet identities and MIME
 * serialization are intentionally outside this resolver.
 */
export async function resolveMagniboxInternalMessage(
  repository: MagniboxInternalMessageResolverRepository,
  input: {
    event: MagniboxSyncOutboxEvent;
    targetMailboxId: string;
  },
): Promise<MagniboxResolvedInternalMessage> {
  const { event, targetMailboxId } = input;

  if (event.aggregate_type !== "internal_message") {
    throw new MagniboxSyncError("Unsupported MAGNIBOX source type", false);
  }
  if (event.event_type !== "message.created" && event.event_type !== "message.updated") {
    throw new MagniboxSyncError("Unsupported event for canonical message resolution", false);
  }
  if (!nonEmpty(event.organization_id) || !nonEmpty(event.aggregate_id) || !nonEmpty(targetMailboxId)) {
    throw new MagniboxSyncError("Invalid canonical message scope", false);
  }

  const message = await repository.getMessage({
    organizationId: event.organization_id,
    messageId: event.aggregate_id,
  });
  if (!message) {
    throw new MagniboxSyncError("Canonical internal message not found", false);
  }
  if (
    message.id !== event.aggregate_id ||
    message.organization_id !== event.organization_id ||
    !nonEmpty(message.sender_mailbox_id) ||
    !nonEmpty(message.recipient_mailbox_id) ||
    !nonEmpty(message.subject) ||
    typeof message.body_text !== "string" ||
    !validTimestamp(message.created_at)
  ) {
    throw new MagniboxSyncError("Canonical internal message failed validation", false);
  }

  const targetRole =
    message.sender_mailbox_id === targetMailboxId
      ? "sender"
      : message.recipient_mailbox_id === targetMailboxId
        ? "recipient"
        : null;
  if (!targetRole) {
    throw new MagniboxSyncError("Target mailbox is not a participant in this message", false);
  }

  const mailbox = await repository.getMailbox({
    organizationId: event.organization_id,
    mailboxId: targetMailboxId,
  });
  if (
    !mailbox ||
    mailbox.id !== targetMailboxId ||
    mailbox.organization_id !== event.organization_id ||
    mailbox.is_active !== true ||
    mailbox.can_read !== true ||
    !nonEmpty(mailbox.owner_user_id) ||
    !nonEmpty(mailbox.local_part)
  ) {
    throw new MagniboxSyncError("Target mailbox is not an active individual readable mailbox", false);
  }

  const hasActiveGrants = await repository.hasActiveGrants({
    organizationId: event.organization_id,
    mailboxId: targetMailboxId,
  });
  if (hasActiveGrants) {
    throw new MagniboxSyncError("Shared mailboxes are excluded from the first IMAP pilot", false);
  }

  // Resolve peer metadata from the same organization; never trust IDs from payload.
  const peerMailboxId =
    targetRole === "sender" ? message.recipient_mailbox_id : message.sender_mailbox_id;
  const peerMailbox = await repository.getMailbox({
    organizationId: event.organization_id,
    mailboxId: peerMailboxId,
  });
  if (
    !peerMailbox ||
    peerMailbox.id !== peerMailboxId ||
    peerMailbox.organization_id !== event.organization_id ||
    !nonEmpty(peerMailbox.local_part)
  ) {
    throw new MagniboxSyncError("Peer mailbox is missing or outside the organization", false);
  }

  const senderMailbox = targetRole === "sender" ? mailbox : peerMailbox;
  const recipientMailbox = targetRole === "recipient" ? mailbox : peerMailbox;

  return {
    kind: "internal",
    organizationId: event.organization_id,
    sourceMessageId: message.id,
    targetMailboxId,
    targetRole,
    sender: {
      mailboxId: senderMailbox.id,
      localPart: senderMailbox.local_part,
      displayName: senderMailbox.display_name,
    },
    recipient: {
      mailboxId: recipientMailbox.id,
      localPart: recipientMailbox.local_part,
      displayName: recipientMailbox.display_name,
    },
    subject: message.subject,
    bodyText: message.body_text,
    createdAt: message.created_at,
  };
}


/**
 * One internal-message outbox event represents one canonical message, not one
 * mailbox delivery. Resolve a projection for each distinct participant using
 * IDs reloaded from the canonical row; payload mailbox IDs are never trusted.
 */
export async function resolveMagniboxInternalMessageForParticipants(
  repository: MagniboxInternalMessageResolverRepository,
  event: MagniboxSyncOutboxEvent,
): Promise<MagniboxResolvedInternalMessage[]> {
  if (
    event.aggregate_type !== "internal_message" ||
    (event.event_type !== "message.created" && event.event_type !== "message.updated") ||
    !nonEmpty(event.organization_id) ||
    !nonEmpty(event.aggregate_id)
  ) {
    throw new MagniboxSyncError("Unsupported event for internal participant resolution", false);
  }

  const message = await repository.getMessage({
    organizationId: event.organization_id,
    messageId: event.aggregate_id,
  });
  if (
    !message ||
    message.id !== event.aggregate_id ||
    message.organization_id !== event.organization_id ||
    !nonEmpty(message.sender_mailbox_id) ||
    !nonEmpty(message.recipient_mailbox_id)
  ) {
    throw new MagniboxSyncError("Canonical internal message participants are unavailable", false);
  }

  const mailboxIds = [...new Set([
    message.sender_mailbox_id,
    message.recipient_mailbox_id,
  ])];

  return Promise.all(
    mailboxIds.map((targetMailboxId) =>
      resolveMagniboxInternalMessage(repository, { event, targetMailboxId })
    ),
  );
}
