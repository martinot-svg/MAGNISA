import {
  decideMagniboxAppendAction,
  MAGNIBOX_APPEND_MARKER_HEADER,
} from "./imap-append-idempotency";
import type { MagniboxImapCredentialProvider } from "./imap-credential-provider";
import type { MagniboxImapAppendLedgerRepository } from "./imap-append-supabase-repository";
import type {
  MagniboxImapMappingScope,
  MagniboxImapMessageMappingRecord,
} from "./imap-mapping-supabase-repository";
import type { MagniboxInternalMessageProjectionSink } from "./internal-message-imap-sync-adapter";
import type { MagniboxDovecotImapAdapter, MagniboxDovecotMailboxSnapshot } from "./dovecot-imap-adapter";
import { MagniboxSyncError, type MagniboxSyncOutboxEvent } from "./imap-sync-core";
import type { MagniboxResolvedInternalMessage } from "./canonical-internal-message-resolver";

export type MagniboxDovecotTargetFolder = {
  folderStateId: string;
  mailboxPath: string;
  storedUidValidity: string;
};

export type MagniboxDovecotProjectionSinkDependencies = {
  credentials: MagniboxImapCredentialProvider;
  transport: MagniboxDovecotImapAdapter;
  appendLedger: MagniboxImapAppendLedgerRepository;
  mappings: {
    get(scope: MagniboxImapMappingScope): Promise<MagniboxImapMessageMappingRecord | null>;
    recordConfirmedUid(input: MagniboxImapMappingScope & {
      uidValidity: string;
      uid: string;
      expectedPreviousUidValidity?: string;
    }): Promise<unknown>;
  };
  resolveTargetFolder(input: {
    organizationId: string;
    mailboxId: string;
    role: "sender" | "recipient";
  }): Promise<MagniboxDovecotTargetFolder>;
  /**
   * Persists UIDNEXT/HIGHESTMODSEQ and performs an explicit, bounded
   * UIDVALIDITY reconciliation when the server epoch differs. Return false
   * until stale mappings have been reconciled; this prevents stale UID reuse.
   */
  observeFolder(input: {
    organizationId: string;
    mailboxId: string;
    folderStateId: string;
    previousUidValidity: string;
    snapshot: MagniboxDovecotMailboxSnapshot;
  }): Promise<boolean>;
  composeMessage(input: {
    projection: MagniboxResolvedInternalMessage;
    operationMarker: string;
  }): Promise<Buffer>;
};

function assertEventScope(event: MagniboxSyncOutboxEvent, projection: MagniboxResolvedInternalMessage): void {
  if (event.organization_id !== projection.organizationId
    || event.aggregate_type !== "internal_message"
    || event.aggregate_id !== projection.sourceMessageId) {
    throw new MagniboxSyncError("IMAP projection scope does not match the claimed event", false);
  }
}

function hasOperationHeader(raw: Buffer, marker: string): boolean {
  const head = raw.subarray(0, Math.min(raw.length, 32 * 1024)).toString("utf8");
  const escapedHeader = MAGNIBOX_APPEND_MARKER_HEADER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escapedHeader}:\\s*${marker}\\s*$`, "im");
  return pattern.test(head);
}

/**
 * Real Dovecot projection sink. It uses the encrypted credential provider,
 * ImapFlow TLS transport, durable APPEND ledger and UID mapping repository.
 * Folder provisioning/reconciliation and MIME policy remain explicit injected
 * boundaries rather than implicit assumptions.
 */
export function createMagniboxDovecotProjectionSink(
  dependencies: MagniboxDovecotProjectionSinkDependencies,
): MagniboxInternalMessageProjectionSink {
  return {
    async applyMailboxProjection({ event, projection }) {
      assertEventScope(event, projection);
      const target = await dependencies.resolveTargetFolder({
        organizationId: projection.organizationId,
        mailboxId: projection.targetMailboxId,
        role: projection.targetRole,
      });
      if (!target.folderStateId || !target.mailboxPath || !target.storedUidValidity) {
        throw new MagniboxSyncError("Dovecot target folder is not provisioned", false);
      }

      const credentials = await dependencies.credentials.getActive({
        organizationId: projection.organizationId,
        mailboxId: projection.targetMailboxId,
      });

      await dependencies.transport.withMailbox(credentials, target.mailboxPath, async (session) => {
        const epochReady = await dependencies.observeFolder({
          organizationId: projection.organizationId,
          mailboxId: projection.targetMailboxId,
          folderStateId: target.folderStateId,
          previousUidValidity: target.storedUidValidity,
          snapshot: session.mailbox,
        });
        if (!epochReady) {
          throw new MagniboxSyncError("Dovecot UIDVALIDITY reconciliation is required before projection");
        }

        const operation = await dependencies.appendLedger.getOrCreate({
          organizationId: projection.organizationId,
          outboxEventId: event.id,
          leaseToken: event.lease_token,
          targetMailboxId: projection.targetMailboxId,
          folderStateId: target.folderStateId,
        });
        if (operation.uidValidity !== session.mailbox.uidValidity) {
          throw new MagniboxSyncError("APPEND ledger UIDVALIDITY differs from the selected Dovecot folder", false);
        }

        const matches = await session.findByOperationMarker(operation.marker);
        if (operation.state === "confirmed" && matches.length !== 1) {
          throw new MagniboxSyncError("Confirmed Dovecot APPEND marker is missing or ambiguous; reconciliation is required");
        }
        const decision = decideMagniboxAppendAction({
          marker: operation.marker,
          operationState: operation.state,
          currentUidValidity: session.mailbox.uidValidity,
          searchMatches: matches,
          confirmedUid: operation.uid,
          confirmedUidValidity: operation.uidValidity,
        });

        let confirmed: { uid: string; uidValidity: string } | null = null;
        if (decision.action === "confirm_existing") {
          confirmed = { uid: decision.uid, uidValidity: decision.uidValidity };
        } else if (decision.action === "already_confirmed") {
          if (!operation.uid) throw new MagniboxSyncError("Confirmed APPEND is missing its UID", false);
          confirmed = { uid: operation.uid, uidValidity: operation.uidValidity };
        } else if (decision.action === "append_allowed") {
          // Complete local serialization before crossing the irreversible APPEND boundary.
          const raw = await dependencies.composeMessage({
            projection,
            operationMarker: operation.marker,
          });
          if (!Buffer.isBuffer(raw) || !hasOperationHeader(raw, operation.marker)) {
            throw new MagniboxSyncError("MIME composer omitted the durable operation marker", false);
          }
          const state = await dependencies.appendLedger.markStarted({
            organizationId: projection.organizationId,
            outboxEventId: event.id,
            leaseToken: event.lease_token,
            operationId: operation.operationId,
          });
          if (state !== "append_started") {
            throw new MagniboxSyncError("APPEND operation is not in a writable state");
          }
          try {
            confirmed = await session.append(raw, [], new Date(projection.createdAt));
          } catch (error) {
            await dependencies.appendLedger.markAmbiguous({
              organizationId: projection.organizationId,
              outboxEventId: event.id,
              leaseToken: event.lease_token,
              operationId: operation.operationId,
            }).catch(() => undefined);
            throw error;
          }
        } else if (decision.action === "search_again") {
          throw new MagniboxSyncError("APPEND outcome is ambiguous; marker search must be retried");
        } else if (decision.action === "duplicate_conflict") {
          throw new MagniboxSyncError("Multiple Dovecot messages share one MAGNIBOX operation marker", false);
        } else {
          throw new MagniboxSyncError("Dovecot APPEND requires UIDVALIDITY reconciliation", false);
        }

        if (!confirmed) throw new MagniboxSyncError("Dovecot APPEND was not confirmed");
        const saved = await dependencies.appendLedger.confirm({
          organizationId: projection.organizationId,
          outboxEventId: event.id,
          leaseToken: event.lease_token,
          operationId: operation.operationId,
          uidValidity: confirmed.uidValidity,
          uid: confirmed.uid,
        });
        if (saved.state !== "confirmed" || saved.uid !== confirmed.uid) {
          throw new MagniboxSyncError("Dovecot APPEND ledger did not confirm the UID");
        }

        const scope: MagniboxImapMappingScope = {
          organizationId: projection.organizationId,
          sourceType: "internal_message",
          sourceMessageId: projection.sourceMessageId,
          folderStateId: target.folderStateId,
        };
        const previous = await dependencies.mappings.get(scope);
        if (previous?.deletedAt) {
          throw new MagniboxSyncError("A tombstoned IMAP mapping cannot be re-created by APPEND", false);
        }
        await dependencies.mappings.recordConfirmedUid({
          ...scope,
          uidValidity: confirmed.uidValidity,
          uid: confirmed.uid,
          ...(previous && previous.uidValidity !== confirmed.uidValidity
            ? { expectedPreviousUidValidity: previous.uidValidity }
            : {}),
        });
      });
    },
  };
}
