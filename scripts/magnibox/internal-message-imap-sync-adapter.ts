import {
  MagniboxSyncError,
  type MagniboxImapSyncAdapter,
  type MagniboxSyncOutboxEvent,
} from "./imap-sync-core";
import {
  resolveMagniboxInternalMessageForParticipants,
  type MagniboxInternalMessageResolverRepository,
  type MagniboxResolvedInternalMessage,
} from "./canonical-internal-message-resolver";

/**
 * The concrete transport is deliberately injected. Implementations must make
 * applyMailboxProjection idempotent using (event.id, projection.targetMailboxId)
 * and reconcile the durable source-message/folder mapping before APPEND.
 */
export interface MagniboxInternalMessageProjectionSink {
  applyMailboxProjection(input: {
    event: MagniboxSyncOutboxEvent;
    projection: MagniboxResolvedInternalMessage;
    idempotencyKey: string;
  }): Promise<void>;
}

/**
 * Worker adapter for the first internal-message pilot.
 *
 * A single outbox event is completed only after every distinct participant
 * mailbox projection succeeds. If the second mailbox fails, the event is
 * retried; the sink MUST safely recognize the already-applied first projection.
 * This class does not itself connect to IMAP or implement MIME serialization.
 */
export function createMagniboxInternalMessageImapSyncAdapter(
  repository: MagniboxInternalMessageResolverRepository,
  sink: MagniboxInternalMessageProjectionSink,
): MagniboxImapSyncAdapter {
  return {
    async apply(event) {
      if (event.aggregate_type !== "internal_message") {
        throw new MagniboxSyncError(
          "External-message IMAP projection is not implemented by this adapter",
          false,
        );
      }

      const projections = await resolveMagniboxInternalMessageForParticipants(
        repository,
        event,
      );

      for (const projection of projections) {
        await sink.applyMailboxProjection({
          event,
          projection,
          idempotencyKey: `${event.id}:${projection.targetMailboxId}`,
        });
      }
    },
  };
}
