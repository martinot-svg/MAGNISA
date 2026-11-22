import { describe, expect, it, vi } from "vitest";
import { createMagniboxDovecotProjectionSink } from "./dovecot-projection-sink";
import type { MagniboxDovecotImapAdapter } from "./dovecot-imap-adapter";
import type { MagniboxSyncOutboxEvent } from "./imap-sync-core";
import type { MagniboxResolvedInternalMessage } from "./canonical-internal-message-resolver";

const event: MagniboxSyncOutboxEvent = {
  id: "event-1",
  organization_id: "org-1",
  aggregate_type: "internal_message",
  aggregate_id: "message-1",
  event_type: "message.created",
  payload: {},
  attempts: 1,
  lease_token: "lease-1",
};

const projection: MagniboxResolvedInternalMessage = {
  kind: "internal",
  organizationId: "org-1",
  sourceMessageId: "message-1",
  targetMailboxId: "mailbox-2",
  targetRole: "recipient",
  sender: { mailboxId: "mailbox-1", localPart: "alice", displayName: "Alice" },
  recipient: { mailboxId: "mailbox-2", localPart: "bob", displayName: "Bob" },
  subject: "Pilot message",
  bodyText: "Hello from the canonical source",
  createdAt: "2026-11-21T08:00:00.000Z",
};

function makeDependencies(searchMatches: Array<{ uid: string; uidValidity: string }> = []) {
  const session = {
    mailbox: { path: "INBOX", uidValidity: "42", uidNext: "9", highestModseq: "0" },
    findByOperationMarker: vi.fn().mockResolvedValue(searchMatches),
    append: vi.fn().mockResolvedValue({ uid: "8", uidValidity: "42" }),
  };
  const transport = {
    withMailbox: vi.fn(async (_credentials, _path, callback) => callback(session)),
  };
  const appendLedger = {
    getOrCreate: vi.fn().mockResolvedValue({
      operationId: "operation-1",
      marker: "mbxop-12345678-1234-4234-8234-123456789abc",
      state: searchMatches.length ? "append_started" : "ready",
      uidValidity: "42",
      uid: null,
    }),
    markStarted: vi.fn().mockResolvedValue("append_started"),
    markAmbiguous: vi.fn().mockResolvedValue("ambiguous"),
    confirm: vi.fn().mockImplementation(async (input) => ({
      operationId: "operation-1",
      marker: "mbxop-12345678-1234-4234-8234-123456789abc",
      state: "confirmed",
      uidValidity: input.uidValidity,
      uid: input.uid,
    })),
  };
  const mappings = {
    get: vi.fn().mockResolvedValue(null),
    recordConfirmedUid: vi.fn().mockResolvedValue({ result: "inserted" }),
  };
  const dependencies = {
    credentials: { getActive: vi.fn().mockResolvedValue({
      host: "mailserver", port: 993, secure: true, username: "pilot", password: "not-a-real-secret",
    }) },
    transport: transport as unknown as MagniboxDovecotImapAdapter,
    appendLedger,
    mappings,
    resolveTargetFolder: vi.fn().mockResolvedValue({
      folderStateId: "folder-2", mailboxPath: "INBOX", storedUidValidity: "42",
    }),
    observeFolder: vi.fn().mockResolvedValue(true),
    composeMessage: vi.fn().mockImplementation(async ({ operationMarker }) =>
      Buffer.from(`Subject: test\r\nX-Magnibox-Operation-ID: ${operationMarker}\r\n\r\nbody\r\n`)),
  };
  return { dependencies, session, transport, appendLedger, mappings };
}

describe("MAGNIBOX Dovecot projection sink", () => {
  it("APPENDs once, confirms UID/UIDVALIDITY and persists the mapping", async () => {
    const setup = makeDependencies();
    const sink = createMagniboxDovecotProjectionSink(setup.dependencies);

    await sink.applyMailboxProjection({
      event,
      projection,
      idempotencyKey: "event-1:mailbox-2",
    });

    expect(setup.session.findByOperationMarker).toHaveBeenCalledWith(
      "mbxop-12345678-1234-4234-8234-123456789abc",
    );
    expect(setup.session.append).toHaveBeenCalledTimes(1);
    expect(setup.appendLedger.markStarted).toHaveBeenCalledTimes(1);
    expect(setup.appendLedger.confirm).toHaveBeenCalledWith(expect.objectContaining({
      uid: "8", uidValidity: "42",
    }));
    expect(setup.mappings.recordConfirmedUid).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-1",
      sourceType: "internal_message",
      sourceMessageId: "message-1",
      folderStateId: "folder-2",
      uid: "8",
      uidValidity: "42",
    }));
  });

  it("recovers an APPEND accepted before a worker interruption without appending again", async () => {
    const setup = makeDependencies([{ uid: "8", uidValidity: "42" }]);
    const sink = createMagniboxDovecotProjectionSink(setup.dependencies);

    await sink.applyMailboxProjection({
      event,
      projection,
      idempotencyKey: "event-1:mailbox-2",
    });

    expect(setup.session.append).not.toHaveBeenCalled();
    expect(setup.appendLedger.markStarted).not.toHaveBeenCalled();
    expect(setup.appendLedger.confirm).toHaveBeenCalledWith(expect.objectContaining({
      uid: "8", uidValidity: "42",
    }));
  });

  it("fails closed when the selected Dovecot UIDVALIDITY changed", async () => {
    const setup = makeDependencies();
    setup.session.mailbox.uidValidity = "43";
    setup.dependencies.observeFolder.mockResolvedValue(false);
    const sink = createMagniboxDovecotProjectionSink(setup.dependencies);

    await expect(sink.applyMailboxProjection({
      event,
      projection,
      idempotencyKey: "event-1:mailbox-2",
    })).rejects.toThrow("Dovecot UIDVALIDITY changed");

    expect(setup.appendLedger.getOrCreate).not.toHaveBeenCalled();
    expect(setup.session.append).not.toHaveBeenCalled();
  });

  it("rejects a projection from another organization before connecting", async () => {
    const setup = makeDependencies();
    const sink = createMagniboxDovecotProjectionSink(setup.dependencies);

    await expect(sink.applyMailboxProjection({
      event,
      projection: { ...projection, organizationId: "org-other" },
      idempotencyKey: "event-1:mailbox-2",
    })).rejects.toThrow("scope does not match");

    expect(setup.transport.withMailbox).not.toHaveBeenCalled();
  });
});
