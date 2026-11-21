import { beforeEach, describe, expect, it, vi } from "vitest";

const fakeClient = vi.hoisted(() => ({
  mailbox: { uidValidity: 42n, uidNext: 9n, highestModseq: 0n },
  connect: vi.fn(),
  getMailboxLock: vi.fn(),
  search: vi.fn(),
  append: vi.fn(),
  logout: vi.fn(),
  release: vi.fn(),
}));

vi.mock("imapflow", () => ({
  ImapFlow: vi.fn(function ImapFlowMock() { return fakeClient; }),
}));

import { ImapFlow } from "imapflow";
import { MagniboxDovecotImapAdapter } from "./dovecot-imap-adapter";

const credentials = {
  host: "mailserver",
  port: 993,
  secure: true as const,
  username: "pilot",
  password: "local-test-password",
};

describe("MagniboxDovecotImapAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeClient.mailbox = { uidValidity: 42n, uidNext: 9n, highestModseq: 0n };
    fakeClient.connect.mockResolvedValue(undefined);
    fakeClient.getMailboxLock.mockResolvedValue({ release: fakeClient.release });
    fakeClient.search.mockResolvedValue([8]);
    fakeClient.append.mockResolvedValue({ uid: 9, uidValidity: 42n });
    fakeClient.logout.mockResolvedValue(undefined);
  });

  it("uses direct TLS with certificate validation and exposes UID metadata", async () => {
    const adapter = new MagniboxDovecotImapAdapter({
      allowedHosts: new Set(["mailserver"]),
      caPem: "-----BEGIN CERTIFICATE----- local test CA -----END CERTIFICATE-----",
    });

    const result = await adapter.withMailbox(credentials, "INBOX", async (session) => {
      expect(session.mailbox).toEqual({
        path: "INBOX",
        uidValidity: "42",
        uidNext: "9",
        highestModseq: "0",
      });
      const found = await session.findByOperationMarker("mbxop-12345678-1234-4234-8234-123456789abc");
      const appended = await session.append(Buffer.from("Subject: test\r\n\r\nbody"), []);
      return { found, appended };
    });

    expect(result).toEqual({
      found: [{ uid: "8", uidValidity: "42" }],
      appended: { uid: "9", uidValidity: "42" },
    });
    const options = vi.mocked(ImapFlow).mock.calls[0]?.[0];
    expect(options).toMatchObject({
      host: "mailserver",
      port: 993,
      secure: true,
      tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
      logger: false,
    });
    expect(options?.tls?.ca).toContain("BEGIN CERTIFICATE");
    expect(fakeClient.release).toHaveBeenCalledTimes(1);
    expect(fakeClient.logout).toHaveBeenCalledTimes(1);
  });

  it("rejects an endpoint outside the operator allowlist before connecting", async () => {
    const adapter = new MagniboxDovecotImapAdapter({ allowedHosts: new Set(["localhost"]) });

    await expect(adapter.withMailbox(credentials, "INBOX", async () => undefined))
      .rejects.toThrow("not in the worker allowlist");

    expect(fakeClient.connect).not.toHaveBeenCalled();
  });

  it("releases the mailbox lock and closes the session after an operation failure", async () => {
    const adapter = new MagniboxDovecotImapAdapter({ allowedHosts: new Set(["mailserver"]) });
    await expect(adapter.withMailbox(credentials, "INBOX", async () => {
      throw new Error("private test detail");
    })).rejects.toThrow("Dovecot IMAP operation failed");

    expect(fakeClient.release).toHaveBeenCalledTimes(1);
    expect(fakeClient.logout).toHaveBeenCalledTimes(1);
  });
});
