/**
 * Server-only boundary for Dovecot credentials.
 *
 * Implementations must use an encrypted secret store/KMS. Never persist the
 * returned password in Supabase application tables, outbox payloads, logs,
 * browser code, or exception messages.
 */
export type MagniboxImapCredentialScope = {
  organizationId: string;
  mailboxId: string;
};

export type MagniboxImapConnectionCredentials = {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
};

export type MagniboxImapCredentialMetadata = {
  credentialId: string;
  organizationId: string;
  mailboxId: string;
  version: number;
  status: "active" | "revoked";
};

export interface MagniboxImapCredentialProvider {
  /** Returns credentials only for the exact organization/mailbox scope. */
  getActive(scope: MagniboxImapCredentialScope): Promise<MagniboxImapConnectionCredentials>;
  /** Rotates credentials atomically; old versions must stop being served. */
  rotate(input: MagniboxImapCredentialScope & {
    credentials: MagniboxImapConnectionCredentials;
    idempotencyKey: string;
  }): Promise<MagniboxImapCredentialMetadata>;
  /** Revocation must prevent subsequent getActive calls from succeeding. */
  revoke(scope: MagniboxImapCredentialScope): Promise<void>;
}

export class MagniboxCredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MagniboxCredentialError";
  }
}

/** Validate configuration without ever including secret values in errors. */
export function validateMagniboxImapCredentials(
  value: MagniboxImapConnectionCredentials,
): void {
  if (!value || typeof value !== "object") {
    throw new MagniboxCredentialError("Invalid IMAP credential configuration");
  }
  if (typeof value.host !== "string" || !value.host.trim() || /[\s/]/.test(value.host)) {
    throw new MagniboxCredentialError("Invalid IMAP host");
  }
  if (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535) {
    throw new MagniboxCredentialError("Invalid IMAP port");
  }
  if (value.secure !== true) {
    throw new MagniboxCredentialError("IMAP connections must use direct TLS");
  }
  if (typeof value.username !== "string" || !value.username.trim()) {
    throw new MagniboxCredentialError("Invalid IMAP username");
  }
  if (typeof value.password !== "string" || value.password.length === 0) {
    throw new MagniboxCredentialError("Missing IMAP password");
  }
}

export function validateMagniboxCredentialScope(scope: MagniboxImapCredentialScope): void {
  if (!scope || typeof scope.organizationId !== "string" || !scope.organizationId.trim()
    || typeof scope.mailboxId !== "string" || !scope.mailboxId.trim()) {
    throw new MagniboxCredentialError("Both organization and mailbox scope are required");
  }
}
