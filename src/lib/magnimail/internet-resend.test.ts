import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  fetchResendReceivedEmail,
  normalizeInternetAddress,
  parseIncomingSender,
  parseInternetRecipients,
  sendResendInternetEmail,
  verifyResendWebhookSignature,
} from "./internet-resend";

describe("MGMail Internet — validation et transport sans Google", () => {
  it("normalise les adresses .mg, .com et .digital", () => {
    expect(normalizeInternetAddress(" FINANCE@MITALIA.DIGITAL ")).toBe("finance@mitalia.digital");
    expect(parseInternetRecipients("client@gmail.com; direction@outlook.com")).toEqual([
      "client@gmail.com", "direction@outlook.com",
    ]);
    expect(parseIncomingSender("Client Mitalia <CLIENT@PROTON.ME>"))
      .toBe("client@proton.me");
  });

  it.each([
    "bad", "finance@entreprise.mgmail\nBcc:evil@example.org",
    "x@-domain.com", "a@domain..com",
  ])("rejette les adresses malformées : %s", (value) => {
    expect(() => normalizeInternetAddress(value)).toThrow();
  });

  it("refuse les destinataires en doublon et la surcharge", () => {
    expect(() => parseInternetRecipients("a@exemple.com,a@exemple.com")).toThrow(/répétés/);
    expect(() => parseInternetRecipients("")).toThrow(/10 destinataires/);
    const tooMany = Array.from({ length: 11 }, (_, i) => `a${i}@example.com`).join(",");
    expect(() => parseInternetRecipients(tooMany)).toThrow(/10 destinataires/);
  });

  it("valide la vraie signature HMAC et refuse les relectures ou corps altérés", () => {
    const payload = JSON.stringify({ type: "email.received", data: { email_id: "email_1234" } });
    const now = 1794585600000;
    const stamp = String(now / 1000);
    const id = "msg_test";
    const key = Buffer.from("1".repeat(32));
    const secret = "whsec_" + key.toString("base64");
    const signature = createHmac("sha256", key)
      .update(`${id}.${stamp}.${payload}`).digest("base64");
    const headers = { id, timestamp: stamp, signature: "v1," + signature };
    expect(verifyResendWebhookSignature(payload, headers, secret, now)).toBe(true);
    expect(verifyResendWebhookSignature(payload + " ", headers, secret, now)).toBe(false);
    expect(verifyResendWebhookSignature(payload, headers, secret, now + 310000)).toBe(false);
    expect(verifyResendWebhookSignature(payload, { ...headers, signature: "v1,bad" },
      secret, now)).toBe(false);
    expect(verifyResendWebhookSignature(payload, headers, "invalid", now)).toBe(false);
  });

  it("envoie uniquement depuis l'identité vérifiée et avec une clé d'idempotence", async () => {
    const transport = vi.fn<typeof fetch>(async (_request, options) => {
      expect(_request).toBe("https://api.resend.com/emails");
      expect(options?.method).toBe("POST");
      const headers = options?.headers as Record<string, string>;
      expect(headers["Idempotency-Key"]).toContain("mgmail-");
      const body = JSON.parse(String(options?.body));
      expect(body.from).toBe("finance@mitalia.digital");
      expect(body.to).toEqual(["client@gmail.com"]);
      expect(body.text).toBe("Votre facture est prévue demain.");
      return Response.json({ id: "email_1234" });
    });
    const accepted = await sendResendInternetEmail({
      apiKey: "test_key",
      from: "finance@mitalia.digital",
      to: ["client@gmail.com"],
      subject: "Préavis",
      body: "Votre facture est prévue demain.",
      requestId: "f2fc69a9-e2ad-4079-8b4b-6c652a16fbab",
    }, transport);
    expect(accepted.id).toBe("email_1234");
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("ne déclare pas livré un envoi refusé par le fournisseur", async () => {
    await expect(sendResendInternetEmail({
      apiKey: "test_key", from: "finance@mitalia.digital", to: ["client@gmail.com"],
      subject: "Objet", body: "Texte", requestId: "f2fc69a9-e2ad-4079-8b4b-6c652a16fbab",
    }, async () => new Response("", { status: 403 }))).rejects.toThrow(/refusé/);
  });

  it("récupère le corps d'un e-mail reçu depuis l'API officielle du fournisseur", async () => {
    const transport = vi.fn<typeof fetch>(async (request) => {
      expect(request).toBe("https://api.resend.com/emails/receiving/email_12345");
      return Response.json({
        from: "Client <client@gmail.com>", to: ["finance@mitalia.digital"],
        subject: "Réponse à la facture", text: "Bonjour, nous confirmons la réception.",
      });
    });
    const result = await fetchResendReceivedEmail("test_key", "email_12345", transport);
    expect(result.from).toBe("client@gmail.com");
    expect(result.text).toContain("confirmons la réception");
  });
});
