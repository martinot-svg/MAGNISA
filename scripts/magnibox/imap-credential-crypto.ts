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
  if (!keyId || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(keyId)
    || !Buffer.isBuffer(key) || key.length !== 32) {
    throw new MagniboxCredentialError("Invalid IMAP credential encryption key configuration");
  }
}

function decodeCanonicalBase64(value: unknown): Buffer {
  if (typeof value !== "string" || value.length === 0
    || value.length % 4 !== 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new MagniboxCredentialError("Invalid Base64 credential material");
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) {
    throw new MagniboxCredentialError("Invalid Base64 credential material");
  }
  return decoded;
}

function getKey(keyring: MagniboxCredentialKeyring, keyId: string): Buffer {
  if (!keyring || typeof keyring !== "object" || !keyring.keys
    || typeof keyring.keys !== "object" || !Object.hasOwn(keyring.keys, keyId)) {
    throw new MagniboxCredentialError("IMAP credential encryption key is unavailable");
  }
  const key = keyring.keys[keyId];
  assertKey(key, keyId);
  return key;
}

export function encryptMagniboxImapCredentials(credentials: MagniboxImapConnectionCredentials, scope: MagniboxImapCredentialScope, keyring: MagniboxCredentialKeyring): MagniboxEncryptedCredentialEnvelope {
  validateMagniboxCredentialScope(scope);
  validateMagniboxImapCredentials(credentials);
  if (!keyring || typeof keyring.activeKeyId !== "string") {
    throw new MagniboxCredentialError("Active IMAP credential encryption key is unavailable");
  }
  const key = getKey(keyring, keyring.activeKeyId);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad(scope));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(credentials), "utf8"), cipher.final()]);
  return { version: 1, algorithm: ALGORITHM, keyId: keyring.activeKeyId, nonce: nonce.toString("base64"), ciphertext: ciphertext.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}

export function decryptMagniboxImapCredentials(envelope: MagniboxEncryptedCredentialEnvelope, scope: MagniboxImapCredentialScope, keyring: MagniboxCredentialKeyring): MagniboxImapConnectionCredentials {
  validateMagniboxCredentialScope(scope);
  if (!envelope || envelope.version !== 1 || envelope.algorithm !== ALGORITHM) throw new MagniboxCredentialError("Unsupported IMAP credential envelope");
  const key = getKey(keyring, envelope.keyId);
  try {
    const nonce = decodeCanonicalBase64(envelope.nonce);
    const tag = decodeCanonicalBase64(envelope.tag);
    const ciphertext = decodeCanonicalBase64(envelope.ciphertext);
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
    const keys: Record<string, Buffer> = Object.create(null) as Record<string, Buffer>;
    for (const [keyId, value] of Object.entries(parsed)) {
      if (typeof value !== "string") throw new Error("invalid key");
      const key = decodeCanonicalBase64(value);
      assertKey(key, keyId);
      keys[keyId] = key;
    }
    if (!Object.hasOwn(keys, activeKeyId)) throw new Error("active key missing");
    return { activeKeyId, keys };
  } catch {
    throw new MagniboxCredentialError("Invalid MAGNIBOX IMAP credential keyring configuration");
  }
}