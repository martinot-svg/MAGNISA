import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { MagniboxCredentialError, validateMagniboxCredentialScope, validateMagniboxImapCredentials, type MagniboxImapConnectionCredentials, type MagniboxImapCredentialScope } from "./imap-credential-provider";

const ALGORITHM = "aes-256-gcm";
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
export type MagniboxEncryptedCredentialEnvelope = { version: 1; algorithm: "aes-256-gcm"; keyId: string; nonce: string; ciphertext: string; tag: string };
export type MagniboxCredentialKeyring = { activeKeyId: string; keys: Readonly<Record<string, Buffer>> };

function aad(scope: MagniboxImapCredentialScope): Buffer {
  validateMagniboxCredentialScope(scope);
  return Buffer.from(`magnibox-imap-credential:v1:org:${scope.organizationId}:mailbox:${scope.mailboxId}`, "utf8");
}
function assertKey(key: Buffer, keyId: string): void {
  if (!keyId || !/^[a-zA-Z0-9._-]{1,80}$/.test(keyId) || !Buffer.isBuffer(key) || key.length !== 32) {
    throw new MagniboxCredentialError("Invalid IMAP credential encryption key configuration");
  }
}

export function encryptMagniboxImapCredentials(credentials: MagniboxImapConnectionCredentials, scope: MagniboxImapCredentialScope, keyring: MagniboxCredentialKeyring): MagniboxEncryptedCredentialEnvelope {
  validateMagniboxCredentialScope(scope);
  validateMagniboxImapCredentials(credentials);
  const key = keyring.keys[keyring.activeKeyId];
  if (!key) throw new MagniboxCredentialError("Active IMAP credential encryption key is unavailable");
  assertKey(key, keyring.activeKeyId);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad(scope));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(credentials), "utf8"), cipher.final()]);
  return { version: 1, algorithm: ALGORITHM, keyId: keyring.activeKeyId, nonce: nonce.toString("base64"), ciphertext: ciphertext.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}

export function decryptMagniboxImapCredentials(envelope: MagniboxEncryptedCredentialEnvelope, scope: MagniboxImapCredentialScope, keyring: MagniboxCredentialKeyring): MagniboxImapConnectionCredentials {
  validateMagniboxCredentialScope(scope);
  if (!envelope || envelope.version !== 1 || envelope.algorithm !== ALGORITHM) throw new MagniboxCredentialError("Unsupported IMAP credential envelope");
  const key = keyring.keys[envelope.keyId];
  if (!key) throw new MagniboxCredentialError("IMAP credential decryption key is unavailable");
  assertKey(key, envelope.keyId);
  try {
    const nonce = Buffer.from(envelope.nonce, "base64");
    const tag = Buffer.from(envelope.tag, "base64");
    const ciphertext = Buffer.from(envelope.ciphertext, "base64");
    if (nonce.length !== NONCE_BYTES || tag.length !== TAG_BYTES || ciphertext.length === 0) throw new Error("invalid envelope");
    const decipher = createDecipheriv(ALGORITHM, key, nonce, { authTagLength: TAG_BYTES });
    decipher.setAAD(aad(scope));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    const parsed: unknown = JSON.parse(plaintext);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid payload");
    const credentials = parsed as MagniboxImapConnectionCredentials;
    validateMagniboxImapCredentials(credentials);
    return credentials;
  } catch {
    throw new MagniboxCredentialError("Unable to decrypt IMAP credentials for the requested mailbox");
  }
}

export function loadMagniboxCredentialKeyring(env: NodeJS.ProcessEnv = process.env): MagniboxCredentialKeyring {
  const activeKeyId = env.MAGNIBOX_IMAP_ACTIVE_KEY_ID;
  const encodedKeys = env.MAGNIBOX_IMAP_CREDENTIALS_KEYS;
  if (!activeKeyId || !encodedKeys) throw new MagniboxCredentialError("MAGNIBOX IMAP credential encryption is not configured");
  try {
    const parsed: unknown = JSON.parse(encodedKeys);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid keyring");
    const keys: Record<string, Buffer> = {};
    for (const [keyId, value] of Object.entries(parsed)) {
      if (typeof value !== "string") throw new Error("invalid key");
      const key = Buffer.from(value, "base64");
      assertKey(key, keyId);
      keys[keyId] = key;
    }
    if (!keys[activeKeyId]) throw new Error("active key missing");
    return { activeKeyId, keys };
  } catch {
    throw new MagniboxCredentialError("Invalid MAGNIBOX IMAP credential keyring configuration");
  }
}