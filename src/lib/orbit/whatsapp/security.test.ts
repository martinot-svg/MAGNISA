import { createHmac, randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decryptWhatsAppToken,
  encryptWhatsAppToken,
  verifyMetaWebhookChallenge,
  verifyMetaWebhookSignature,
} from "./security";

const KEY = randomBytes(32).toString("base64");
const APP_SECRET = "meta-app-secret-for-tests";

afterEach(() => vi.unstubAllEnvs());

describe("ORBIT WhatsApp token encryption", () => {
  it("round-trips a token using AES-256-GCM", () => {
    vi.stubEnv("WHATSAPP_TOKEN_ENCRYPTION_KEY", KEY);
    const token = "EAAG-test-access-token-value-123456";
    const encrypted = encryptWhatsAppToken(token);
    expect(encrypted.keyVersion).toBe(1);
    expect(encrypted.ciphertext).not.toContain(token);
    expect(decryptWhatsAppToken(encrypted.ciphertext, encrypted.keyVersion)).toBe(token);
  });

  it("uses a fresh nonce for every encryption", () => {
    vi.stubEnv("WHATSAPP_TOKEN_ENCRYPTION_KEY", KEY);
    const first = encryptWhatsAppToken("EAAG-same-token-value-123456");
    const second = encryptWhatsAppToken("EAAG-same-token-value-123456");
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it("rejects missing or incorrectly sized encryption keys", () => {
    vi.stubEnv("WHATSAPP_TOKEN_ENCRYPTION_KEY", "");
    expect(() => encryptWhatsAppToken("EAAG-test-access-token-value")).toThrow(/n'est pas configurée/);
    vi.stubEnv("WHATSAPP_TOKEN_ENCRYPTION_KEY", Buffer.from("short").toString("base64"));
    expect(() => encryptWhatsAppToken("EAAG-test-access-token-value")).toThrow(/32 octets/);
  });

  it("rejects tampered ciphertext and unsupported versions", () => {
    vi.stubEnv("WHATSAPP_TOKEN_ENCRYPTION_KEY", KEY);
    const encrypted = encryptWhatsAppToken("EAAG-test-access-token-value");
    const parts = encrypted.ciphertext.split(".");
    parts[3] = Buffer.from("tampered-value").toString("base64url");
    expect(() => decryptWhatsAppToken(parts.join("."), 1)).toThrow();
    expect(() => decryptWhatsAppToken(encrypted.ciphertext, 2)).toThrow(/non prise en charge/);
  });
});

describe("ORBIT WhatsApp Meta webhook verification", () => {
  it("accepts only the exact raw body HMAC SHA-256 signature", () => {
    const body = '{"object":"whatsapp_business_account","entry":[]}';
    const signature = "sha256=" + createHmac("sha256", APP_SECRET).update(body).digest("hex");
    expect(verifyMetaWebhookSignature(body, signature, APP_SECRET)).toBe(true);
    expect(verifyMetaWebhookSignature(body + " ", signature, APP_SECRET)).toBe(false);
    expect(verifyMetaWebhookSignature(body, "sha256=" + "0".repeat(64), APP_SECRET)).toBe(false);
  });

  it("rejects malformed, missing and empty signatures", () => {
    expect(verifyMetaWebhookSignature("{}", null, APP_SECRET)).toBe(false);
    expect(verifyMetaWebhookSignature("{}", "sha1=abcd", APP_SECRET)).toBe(false);
    expect(verifyMetaWebhookSignature("{}", "sha256=abcd", APP_SECRET)).toBe(false);
    expect(verifyMetaWebhookSignature("{}", "sha256=" + "a".repeat(64), "")).toBe(false);
  });

  it("compares webhook challenge tokens without accepting blanks", () => {
    expect(verifyMetaWebhookChallenge("challenge-token", "challenge-token")).toBe(true);
    expect(verifyMetaWebhookChallenge("wrong-token", "challenge-token")).toBe(false);
    expect(verifyMetaWebhookChallenge("", "challenge-token")).toBe(false);
    expect(verifyMetaWebhookChallenge("challenge-token", "")).toBe(false);
  });
});
