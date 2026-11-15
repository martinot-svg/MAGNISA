import nodemailer from "nodemailer";
import { normalizePublicEmail } from "./address";
import type { InternetTransport, OutgoingInternetMessage } from "./types";

type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  heloName: string;
};

type MailResult = { messageId?: string; accepted?: unknown[]; rejected?: unknown[] };
type Mailer = { sendMail(input: Record<string, unknown>): Promise<MailResult> };
type MailerFactory = (options: Record<string, unknown>) => Mailer;

export function magniboxSmtpConfig(
  env: NodeJS.ProcessEnv = process.env,
): SmtpConfig | null {
  const host = env.MAGNIBOX_SMTP_HOST?.trim().toLowerCase();
  const user = env.MAGNIBOX_SMTP_USER?.trim();
  const password = env.MAGNIBOX_SMTP_PASSWORD;
  const port = Number(env.MAGNIBOX_SMTP_PORT || "587");
  const secure = env.MAGNIBOX_SMTP_SECURE === "true" || port === 465;
  const heloName = env.MAGNIBOX_SMTP_HELO?.trim().toLowerCase() || host || "";
  if (!host || !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host)
    || !user || !password || !Number.isInteger(port) || port < 1 || port > 65535
    || !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(heloName)) {
    return null;
  }
  return { host, port, secure, user, password, heloName };
}

/** MAGNIBOX-owned SMTP submission transport. Credentials stay server-side. */
export class MagniboxSmtpTransport implements InternetTransport {
  readonly provider = "smtp" as const;
  private readonly config: SmtpConfig | null;

  constructor(
    env: NodeJS.ProcessEnv = process.env,
    private readonly factory: MailerFactory = (options) =>
      nodemailer.createTransport(options) as unknown as Mailer,
  ) {
    this.config = magniboxSmtpConfig(env);
  }

  async send(message: OutgoingInternetMessage) {
    const config = this.config;
    if (!config) throw new Error("Transport SMTP MAGNIBOX non configuré.");
    const from = normalizePublicEmail(message.from);
    const to = message.to.map(normalizePublicEmail);
    if (to.length < 1 || to.length > 10 || new Set(to).size !== to.length) {
      throw new Error("Destinataires de courrier externe invalides.");
    }
    const subject = message.subject.trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(message.requestId)
      || !subject || subject.length > 180 || !message.text.trim()
      || message.text.length > 50000) {
      throw new Error("Message ou clé de déduplication invalide.");
    }

    const mailer = this.factory({
      host: config.host,
      port: config.port,
      secure: config.secure,
      name: config.heloName,
      auth: { user: config.user, pass: config.password },
      requireTLS: !config.secure,
      tls: { rejectUnauthorized: true, servername: config.host },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
      pool: true,
      maxConnections: 3,
      maxMessages: 100,
    });
    const result = await mailer.sendMail({
      from,
      to,
      subject,
      text: message.text,
      messageId: `<${message.requestId}@${from.split("@")[1]}>`,
      headers: { "X-Magnibox-Request-ID": message.requestId },
    });
    if (typeof result.messageId !== "string" || !result.messageId.trim()
      || !Array.isArray(result.accepted) || result.accepted.length !== to.length
      || (Array.isArray(result.rejected) && result.rejected.length > 0)) {
      throw new Error("Le serveur SMTP MAGNIBOX n'a pas confirmé l'acceptation.");
    }
    return {
      provider: this.provider,
      providerMessageId: result.messageId,
      state: "accepted" as const,
    };
  }
}
