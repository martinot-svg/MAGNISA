import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const TOKEN_CIPHER_VERSION = 1;
const TOKEN_CIPHER_ALGORITHM = "aes-256-gcm";

function encryptionKey(): Buffer {
  const encoded = process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY;
  if (!encoded) throw new Error("WHATSAPP_TOKEN_ENCRYPTION_KEY n'est pas configurée.");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) {
    throw new Error("WHATSAPP_TOKEN_ENCRYPTION_KEY doit contenir une clé base64 de 32 octets.");
  }
  return key;
}

/** Encrypt Meta access tokens before they are persisted; the key never enters the database. */
export function encryptWhatsAppToken(token: string): { ciphertext: string; keyVersion: number } {
  if (typeof token !== "string" || token.length < 16 || token.length > 8192) {
    throw new Error("Jeton WhatsApp invalide.");
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv(TOKEN_CIPHER_ALGORITHM, encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: [
      "v1",
      iv.toString("base64url"),
      tag.toString("base64url"),
      encrypted.toString("base64url"),
    ].join("."),
    keyVersion: TOKEN_CIPHER_VERSION,
  };
}

export function decryptWhatsAppToken(ciphertext: string, keyVersion: number): string {
  if (keyVersion !== TOKEN_CIPHER_VERSION || typeof ciphertext !== "string") {
    throw new Error("Version de chiffrement du jeton WhatsApp non prise en charge.");
  }
  const [version, ivPart, tagPart, encryptedPart, extra] = ciphertext.split(".");
  if (version !== "v1" || !ivPart || !tagPart || !encryptedPart || extra !== undefined) {
    throw new Error("Format du jeton WhatsApp chiffré invalide.");
  }
  const iv = Buffer.from(ivPart, "base64url");
  const tag = Buffer.from(tagPart, "base64url");
  const encrypted = Buffer.from(encryptedPart, "base64url");
  if (iv.length !== 12 || tag.length !== 16 || encrypted.length === 0) {
    throw new Error("Données du jeton WhatsApp chiffré invalides.");
  }
  const decipher = createDecipheriv(TOKEN_CIPHER_ALGORITHM, encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

/** Verify Meta's X-Hub-Signature-256 over the exact, unmodified request body. */
export function verifyMetaWebhookSignature(
  rawBody: string,
  signature: string | null,
  appSecret: string,
): boolean {
  if (!signature || !/^sha256=[a-f0-9]{64}$/i.test(signature) || !appSecret) return false;
  const supplied = Buffer.from(signature.slice("sha256=".length), "hex");
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

/** Compare the GET webhook verification token without accepting empty values. */
export function verifyMetaWebhookChallenge(
  suppliedToken: string | null,
  expectedToken: string,
): boolean {
  if (!suppliedToken || !expectedToken) return false;
  const supplied = Buffer.from(suppliedToken, "utf8");
  const expected = Buffer.from(expectedToken, "utf8");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
