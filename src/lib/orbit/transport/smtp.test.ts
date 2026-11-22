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
      accepted: ["client@example.com"],
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

  it("rejects an SMTP queue response that accepts a different recipient", async () => {
    const sendMail = vi.fn().mockResolvedValue({
      messageId: "<request@example.com>",
      response: "250 2.0.0 Ok: queued as ABC123DEF",
      accepted: ["attacker@example.net"],
      rejected: [],
    });
    const transport = new MagniboxSmtpTransport(env as NodeJS.ProcessEnv, () => ({ sendMail }));
    await expect(transport.send({
      from: "finance@entreprise.mg", to: ["client@example.com"],
      subject: "Facture", text: "Bonjour",
      requestId: "aeeb4255-0860-45d8-9c92-72488919ee51",
    })).rejects.toThrow(/tous les destinataires/);
  });

  it("submits only bounded validated attachments", async () => {
    const sendMail = vi.fn().mockResolvedValue({
      messageId: "<request@example.com>",
      response: "250 2.0.0 Ok: queued as ABC123DEF",
      accepted: ["client@example.com"],
      rejected: [],
    });
    const transport = new MagniboxSmtpTransport(env as NodeJS.ProcessEnv, () => ({ sendMail }));
    const attachment = { filename: "invoice.pdf", content: Buffer.from("%PDF-test"), contentType: "application/pdf" };
    await transport.send({
      from: "finance@entreprise.mg", to: ["client@example.com"],
      subject: "Facture", text: "Bonjour",
      requestId: "aeeb4255-0860-45d8-9c92-72488919ee51",
      attachments: [attachment],
    });
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      attachments: [{ filename: "invoice.pdf", content: attachment.content, contentType: "application/pdf" }],
    }));
  });

  it("rejects files above 30 MiB before SMTP submission", async () => {
    const sendMail = vi.fn();
    const transport = new MagniboxSmtpTransport(env as NodeJS.ProcessEnv, () => ({ sendMail }));
    await expect(transport.send({
      from: "finance@entreprise.mg", to: ["client@example.com"],
      subject: "Facture", text: "Bonjour",
      requestId: "aeeb4255-0860-45d8-9c92-72488919ee51",
      attachments: [{ filename: "large.pdf", content: Buffer.alloc(30 * 1024 * 1024 + 1), contentType: "application/pdf" }],
    })).rejects.toThrow(/Pièces jointes/);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("rejects oversized or unsafe attachment metadata before SMTP submission", async () => {
    const sendMail = vi.fn();
    const transport = new MagniboxSmtpTransport(env as NodeJS.ProcessEnv, () => ({ sendMail }));
    await expect(transport.send({
      from: "finance@entreprise.mg", to: ["client@example.com"],
      subject: "Facture", text: "Bonjour",
      requestId: "aeeb4255-0860-45d8-9c92-72488919ee51",
      attachments: [{ filename: "../invoice.pdf", content: Buffer.from("x"), contentType: "application/pdf" }],
    })).rejects.toThrow(/Pièces jointes/);
    expect(sendMail).not.toHaveBeenCalled();
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
  it("verifies SMTP connectivity and authentication without sending a message", async () => {
    const verify = vi.fn().mockResolvedValue(true);
    const close = vi.fn();
    const sendMail = vi.fn();
    const factory = vi.fn(() => ({ sendMail, verify, close }));
    const transport = new MagniboxSmtpTransport(env as NodeJS.ProcessEnv, factory);
    await expect(transport.verifyConnection()).resolves.toEqual({ provider: "smtp", connected: true });
    expect(verify).toHaveBeenCalledOnce();
    expect(sendMail).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
    expect(factory).toHaveBeenCalledWith(expect.objectContaining({
      host: "smtp.internal.magnibox.net",
      port: 587,
      requireTLS: true,
      tls: expect.objectContaining({ rejectUnauthorized: true }),
    }));
  });

  it("closes the SMTP connection when verification fails", async () => {
    const verify = vi.fn().mockRejectedValue(new Error("authentication failed"));
    const close = vi.fn();
    const transport = new MagniboxSmtpTransport(env as NodeJS.ProcessEnv, () => ({
      sendMail: vi.fn(), verify, close,
    }));
    await expect(transport.verifyConnection()).rejects.toThrow("authentication failed");
    expect(close).toHaveBeenCalledOnce();
  });

  it("closes the request-scoped SMTP transport after submission", async () => {
    const close = vi.fn();
    const sendMail = vi.fn().mockResolvedValue({
      messageId: "<request@example.com>",
      response: "250 2.0.0 Ok: queued as ABC123DEF",
      accepted: ["client@example.com"],
      rejected: [],
    });
    const transport = new MagniboxSmtpTransport(env as NodeJS.ProcessEnv, () => ({
      sendMail, close,
    }));
    await transport.send({
      from: "finance@entreprise.mg", to: ["client@example.com"],
      subject: "Facture", text: "Bonjour",
      requestId: "aeeb4255-0860-45d8-9c92-72488919ee51",
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it("closes the request-scoped SMTP transport when submission throws", async () => {
    const close = vi.fn();
    const transport = new MagniboxSmtpTransport(env as NodeJS.ProcessEnv, () => ({
      sendMail: vi.fn().mockRejectedValue(new Error("connection reset")), close,
    }));
    await expect(transport.send({
      from: "finance@entreprise.mg", to: ["client@example.com"],
      subject: "Facture", text: "Bonjour",
      requestId: "aeeb4255-0860-45d8-9c92-72488919ee51",
    })).rejects.toThrow("connection reset");
    expect(close).toHaveBeenCalledOnce();
  });

});
