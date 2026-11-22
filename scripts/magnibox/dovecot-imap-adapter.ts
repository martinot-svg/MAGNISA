import { ImapFlow } from "imapflow";
import {
  validateMagniboxImapCredentials,
  type MagniboxImapConnectionCredentials,
} from "./imap-credential-provider";
import { MagniboxSyncError } from "./imap-sync-core";
import { MAGNIBOX_APPEND_MARKER_HEADER, validateMagniboxAppendMarker } from "./imap-append-idempotency";

export type MagniboxDovecotMailboxSnapshot = {
  path: string;
  uidValidity: string;
  uidNext: string | null;
  highestModseq: string | null;
};

export type MagniboxDovecotAppendResult = {
  uid: string;
  uidValidity: string;
};

export type MagniboxDovecotSearchResult = {
  uid: string;
  uidValidity: string;
};

export type MagniboxDovecotSession = {
  mailbox: MagniboxDovecotMailboxSnapshot;
  findByOperationMarker(marker: string): Promise<MagniboxDovecotSearchResult[]>;
  append(rawMessage: Buffer, flags?: string[], internalDate?: Date): Promise<MagniboxDovecotAppendResult>;
};

export type MagniboxDovecotAdapterOptions = {
  /** Exact host allowlist; network egress must also be restricted outside the process. */
  allowedHosts: ReadonlySet<string>;
  connectionTimeoutMs?: number;
  greetingTimeoutMs?: number;
  socketTimeoutMs?: number;
  caPem?: string;
};

function positiveImapInteger(value: unknown, label: string): string {
  let normalized: string;
  try {
    normalized = typeof value === "bigint" ? value.toString() : String(value);
  } catch {
    throw new MagniboxSyncError(`Invalid Dovecot ${label}`, false);
  }
  if (!/^[1-9][0-9]*$/.test(normalized) || normalized.length > 19
    || (normalized.length === 19 && normalized > "9223372036854775807")) {
    throw new MagniboxSyncError(`Invalid Dovecot ${label}`, false);
  }
  return normalized;
}

function nonNegativeImapInteger(value: unknown, label: string): string {
  let normalized: string;
  try {
    normalized = typeof value === "bigint" ? value.toString() : String(value);
  } catch {
    throw new MagniboxSyncError(`Invalid Dovecot ${label}`, false);
  }
  if (!/^(0|[1-9][0-9]*)$/.test(normalized) || normalized.length > 19
    || (normalized.length === 19 && normalized > "9223372036854775807")) {
    throw new MagniboxSyncError(`Invalid Dovecot ${label}`, false);
  }
  return normalized;
}

function nullableImapInteger(value: unknown, label: string, allowZero = false): string | null {
  if (value === undefined || value === null) return null;
  return allowZero ? nonNegativeImapInteger(value, label) : positiveImapInteger(value, label);
}

/**
 * Concrete IMAP-over-TLS adapter for Dovecot.
 *
 * The adapter accepts credentials only from the server-side credential vault.
 * It never disables certificate validation and refuses hosts outside the
 * operator-provisioned allowlist. Host allowlisting is defense in depth: the
 * worker's network policy must independently restrict outbound destinations.
 */
export class MagniboxDovecotImapAdapter {
  constructor(private readonly options: MagniboxDovecotAdapterOptions) {}

  /**
   * Idempotently provisions operator-requested folders. It never renames or
   * deletes server folders; callers must pass an explicit, tenant-scoped list.
   */
  async ensureMailboxes(
    credentials: MagniboxImapConnectionCredentials,
    requestedPaths: string[],
  ): Promise<{ existing: string[]; created: string[] }> {
    validateMagniboxImapCredentials(credentials);
    if (!this.options.allowedHosts.has(credentials.host.toLowerCase())) {
      throw new MagniboxSyncError("IMAP endpoint is not in the worker allowlist", false);
    }
    if (!Array.isArray(requestedPaths) || requestedPaths.length < 1 || requestedPaths.length > 100
      || requestedPaths.some(path => typeof path !== "string" || !path.trim()
        || path.length > 255 || /[\\r\\n\\x00]/.test(path))) {
      throw new MagniboxSyncError("Invalid requested IMAP folder set", false);
    }
    const uniquePaths = [...new Set(requestedPaths)];
    const client = new ImapFlow({
      host: credentials.host,
      port: credentials.port,
      secure: true,
      auth: { user: credentials.username, pass: credentials.password },
      tls: { rejectUnauthorized: true, minVersion: "TLSv1.2", ...(this.options.caPem ? { ca: this.options.caPem } : {}) },
      logger: false,
      connectionTimeout: this.options.connectionTimeoutMs ?? 10_000,
      greetingTimeout: this.options.greetingTimeoutMs ?? 10_000,
      socketTimeout: this.options.socketTimeoutMs ?? 30_000,
    });
    let connected = false;
    try {
      await client.connect();
      connected = true;
      const listed = await client.list();
      if (!Array.isArray(listed)) throw new MagniboxSyncError("Dovecot folder listing was not definitive");
      const existingSet = new Set(listed.map(item => item.path));
      const existing: string[] = [];
      const created: string[] = [];
      for (const path of uniquePaths) {
        if (existingSet.has(path)) {
          existing.push(path);
          continue;
        }
        const result = await client.mailboxCreate(path);
        if (result === false) throw new MagniboxSyncError("Dovecot folder creation was not confirmed");
        created.push(path);
        existingSet.add(path);
      }
      return { existing, created };
    } catch (error) {
      if (error instanceof MagniboxSyncError) throw error;
      throw new MagniboxSyncError("Dovecot folder provisioning failed");
    } finally {
      if (connected) {
        try { await client.logout(); } catch { /* preserve operation result */ }
      }
    }
  }

  async withMailbox<T>(
    credentials: MagniboxImapConnectionCredentials,
    mailboxPath: string,
    operation: (session: MagniboxDovecotSession) => Promise<T>,
  ): Promise<T> {
    validateMagniboxImapCredentials(credentials);
    const allowedHosts = this.options.allowedHosts;
    if (!allowedHosts.has(credentials.host.toLowerCase())) {
      throw new MagniboxSyncError("IMAP endpoint is not in the worker allowlist", false);
    }
    if (typeof mailboxPath !== "string" || !mailboxPath.trim() || mailboxPath.length > 255
      || /[\r\n\x00]/.test(mailboxPath)) {
      throw new MagniboxSyncError("Invalid IMAP mailbox path", false);
    }

    const client = new ImapFlow({
      host: credentials.host,
      port: credentials.port,
      secure: true,
      auth: { user: credentials.username, pass: credentials.password },
      tls: { rejectUnauthorized: true, minVersion: "TLSv1.2", ...(this.options.caPem ? { ca: this.options.caPem } : {}) },
      logger: false,
      connectionTimeout: this.options.connectionTimeoutMs ?? 10_000,
      greetingTimeout: this.options.greetingTimeoutMs ?? 10_000,
      socketTimeout: this.options.socketTimeoutMs ?? 30_000,
    });

    let lock: { release(): void } | null = null;
    let connected = false;
    try {
      await client.connect();
      connected = true;
      lock = await client.getMailboxLock(mailboxPath, { description: "MAGNIBOX projection" });
      const mailbox = client.mailbox;
      if (!mailbox) throw new MagniboxSyncError("Dovecot did not select the requested mailbox");
      const uidValidity = positiveImapInteger(mailbox.uidValidity, "UIDVALIDITY");
      const snapshot: MagniboxDovecotMailboxSnapshot = {
        path: mailboxPath,
        uidValidity,
        uidNext: nullableImapInteger(mailbox.uidNext, "UIDNEXT"),
        highestModseq: nullableImapInteger(mailbox.highestModseq, "HIGHESTMODSEQ", true),
      };

      const session: MagniboxDovecotSession = {
        mailbox: snapshot,
        async findByOperationMarker(marker) {
          const safeMarker = validateMagniboxAppendMarker(marker);
          const found = await client.search({
            header: { [MAGNIBOX_APPEND_MARKER_HEADER]: safeMarker },
          }, { uid: true });
          if (!Array.isArray(found)) {
            throw new MagniboxSyncError("Dovecot marker search did not return a definitive result");
          }
          return found.map((uid) => ({
            uid: positiveImapInteger(uid, "UID"),
            uidValidity,
          }));
        },
        async append(rawMessage, flags = [], internalDate) {
          if (!Buffer.isBuffer(rawMessage) || rawMessage.length === 0) {
            throw new MagniboxSyncError("Invalid RFC 822 message for Dovecot APPEND", false);
          }
          const result = await client.append(mailboxPath, rawMessage, flags, internalDate);
          if (!result || result.uid === undefined || result.uid === null
            || result.uidValidity === undefined || result.uidValidity === null) {
            throw new MagniboxSyncError("Dovecot APPEND did not confirm UIDPLUS metadata");
          }
          const appendedUidValidity = positiveImapInteger(result.uidValidity, "APPEND UIDVALIDITY");
          if (appendedUidValidity !== uidValidity) {
            throw new MagniboxSyncError("Dovecot UIDVALIDITY changed during APPEND");
          }
          return {
            uid: positiveImapInteger(result.uid, "APPEND UID"),
            uidValidity: appendedUidValidity,
          };
        },
      };
      return await operation(session);
    } catch (error) {
      if (error instanceof MagniboxSyncError) throw error;
      // Do not forward ImapFlow exceptions: they may contain server details.
      throw new MagniboxSyncError("Dovecot IMAP operation failed");
    } finally {
      lock?.release();
      if (connected) {
        try {
          await client.logout();
        } catch {
          // A failed logout must not hide the original operation result.
        }
      }
    }
  }
}
