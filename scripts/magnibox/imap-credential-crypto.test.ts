import { describe, expect, it } from "vitest";
import {
  decryptMagniboxImapCredentials,
  encryptMagniboxImapCredentials,
  loadMagniboxCredentialKeyring,
  type MagniboxCredentialKeyring,
} from "./imap-credential-crypto";
import { MagniboxCredentialError } from "./imap-credential-provider";

const scope = { organizationId: "org-a", mailboxId: "box-a" };
const credentials = {
  host: "imap.internal",
  port: 993,
  secure: true,
  username: "box-a-user",
  password: "very-secret-test-value",
};
const keyring: MagniboxCredentialKeyring = {
  activeKeyId: "test-key-v1",
  keys: { "test-key-v1": Buffer.alloc(32, 7) },
};

describe("MAGNIBOX IMAP credential encryption", () => {
  it("round-trips credentials using authenticated encryption", () => {
    const envelope = encryptMagniboxImapCredentials(credentials, scope, keyring);
    expect(envelope.ciphertext).not.toContain(credentials.password);
    expect(decryptMagniboxImapCredentials(envelope, scope, keyring)).toEqual(credentials);
  });

  it("uses a fresh nonce for every encryption", () => {
    const first = encryptMagniboxImapCredentials(credentials, scope, keyring);
    const second = encryptMagniboxImapCredentials(credentials, scope, keyring);
    expect(first.nonce).not.toBe(second.nonce);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it("binds ciphertext to the organization and mailbox", () => {
    const envelope = encryptMagniboxImapCredentials(credentials, scope, keyring);
    expect(() => decryptMagniboxImapCredentials(
      envelope,
      { organizationId: "org-b", mailboxId: "box-a" },
      keyring,
    )).toThrow(MagniboxCredentialError);
    expect(() => decryptMagniboxImapCredentials(
      envelope,
      { organizationId: "org-a", mailboxId: "box-b" },
      keyring,
    )).toThrow(MagniboxCredentialError);
  });

  it("rejects non-canonical Base64 envelope fields", () => {
    const envelope = encryptMagniboxImapCredentials(credentials, scope, keyring);
    expect(() => decryptMagniboxImapCredentials(
      { ...envelope, nonce: `${envelope.nonce.slice(0, -2)}==` },
      scope,
      keyring,
    )).toThrow(MagniboxCredentialError);
    expect(() => decryptMagniboxImapCredentials(
      { ...envelope, ciphertext: `${envelope.ciphertext}\\n` },
      scope,
      keyring,
    )).toThrow(MagniboxCredentialError);
  });

  it("loads only canonical 32-byte keys and rejects unsafe key identifiers", () => {
    const encoded = Buffer.alloc(32, 4).toString("base64");
    expect(loadMagniboxCredentialKeyring({
      MAGNIBOX_IMAP_ACTIVE_KEY_ID: "valid-v1",
      MAGNIBOX_IMAP_CREDENTIALS_KEYS: JSON.stringify({ "valid-v1": encoded }),
    }).keys["valid-v1"]).toEqual(Buffer.alloc(32, 4));
    expect(() => loadMagniboxCredentialKeyring({
      MAGNIBOX_IMAP_ACTIVE_KEY_ID: "valid-v1",
      MAGNIBOX_IMAP_CREDENTIALS_KEYS: JSON.stringify({ "valid-v1": `${encoded}!!` }),
    })).toThrow(MagniboxCredentialError);
    expect(() => loadMagniboxCredentialKeyring({
      MAGNIBOX_IMAP_ACTIVE_KEY_ID: "__proto__",
      MAGNIBOX_IMAP_CREDENTIALS_KEYS: JSON.stringify({ "__proto__": encoded }),
    })).toThrow(MagniboxCredentialError);
  });

  it("rejects tampering and missing keys without exposing the password", () => {
    const envelope = encryptMagniboxImapCredentials(credentials, scope, keyring);
    const tampered = { ...envelope, ciphertext: Buffer.from("tampered").toString("base64") };
    try {
      decryptMagniboxImapCredentials(tampered, scope, keyring);
      throw new Error("Expected tampered envelope to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(MagniboxCredentialError);
      expect((error as Error).message).not.toContain(credentials.password);
    }
    expect(() => decryptMagniboxImapCredentials(envelope, scope, {
      activeKeyId: "missing",
      keys: {},
    })).toThrow(MagniboxCredentialError);
  });
});
