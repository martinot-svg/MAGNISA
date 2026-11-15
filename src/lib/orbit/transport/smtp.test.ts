import { describe, expect, it, vi } from "vitest";
import { MagniboxSmtpTransport, magniboxSmtpConfig } from "./smtp";

const env = {
  MAGNIBOX_SMTP_HOST: "smtp.internal.magnibox.net",
  MAGNIBOX_SMTP_PORT: "587",
  MAGNIBOX_SMTP_USER: "magnibox-submit",
  MAGNIBOX_SMTP_PASSWORD: "test-secret",
  MAGNIBOX_SMTP_HELO: "mx.magnibox.net",
};

describe("Magnibox native SMTP transport", () => {
  it("fails closed when the internal SMTP server is not configured", () => {
    expect(magniboxSmtpConfig({} as NodeJS.ProcessEnv)).toBeNull();
    expect(() => new MagniboxSmtpTransport({} as NodeJS.ProcessEnv)).toBeTruthy();
  });

  it("requires valid host, credentials and a valid port", () => {
    expect(magniboxSmtpConfig(env as NodeJS.ProcessEnv)?.host).toBe("smtp.internal.magnibox.net");
    expect(magniboxSmtpConfig({ ...env, MAGNIBOX_SMTP_PORT: "70000" } as NodeJS.ProcessEnv)).toBeNull();
    expect(magniboxSmtpConfig({ ...env, MAGNIBOX_SMTP_PASSWORD: "" } as NodeJS.ProcessEnv)).toBeNull();
    expect(magniboxSmtpConfig({ ...env, MAGNIBOX_SMTP_HOST: "https://evil.test" } as NodeJS.ProcessEnv)).toBeNull();
  });

  it("submits only a validated sender with stable request ID and TLS", async () => {
    const sendMail = vi.fn().mockResolvedValue({
      messageId: "<request@example.com>",
      response: "250 2.0.0 Ok: queued as ABC123DEF",
      accepted: ["client@example.net"],
    });
    const factory = vi.fn(() => ({ sendMail }));
    const transport = new MagniboxSmtpTransport(env as NodeJS.ProcessEnv, factory);
    const result = await transport.send({
      from: "finance@entreprise.mg",
      to: ["client@example.com"],
      subject: "Facture",
      text: "Bonjour",
      requestId: "aeeb4255-0860-45d8-9c92-72488919ee51",
    });
    expect(result).toEqual({
      provider: "smtp",
      providerMessageId: "ABC123DEF",
      state: "accepted",
    });
    expect(factory).toHaveBeenCalledWith(expect.objectContaining({
      host: "smtp.internal.magnibox.net",
      port: 587,
      requireTLS: true,
      pool: false,
      tls: expect.objectContaining({ rejectUnauthorized: true }),
    }));
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: "finance@entreprise.mg",
      to: ["client@example.com"],
      headers: { "X-Magnibox-Request-ID": "aeeb4255-0860-45d8-9c92-72488919ee51" },
    }));
  });

  it("rejects malformed request IDs and does not report a delivery confirmation", async () => {
    const sendMail = vi.fn();
    const transport = new MagniboxSmtpTransport(env as NodeJS.ProcessEnv, () => ({ sendMail }));
    await expect(transport.send({
      from: "finance@entreprise.mg", to: ["client@example.com"],
      subject: "Facture", text: "Bonjour", requestId: "invalid",
    })).rejects.toThrow();
    expect(sendMail).not.toHaveBeenCalled();
  });
});
