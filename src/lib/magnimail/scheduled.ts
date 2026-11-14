import { normalizeInternetAddress, parseInternetRecipients } from "./internet-resend";
import { planBillingPreavis, renderBillingPreavis, type PreavisRule } from "./preavis";

export type ScheduledContent = {
  to: string[];
  subject: string;
  body: string;
  scheduledAt: string;
};

const MADAGASCAR_TIME = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Heure explicite d'Antananarivo (UTC+03, sans passage été/hiver).
 * Une future sélection de fuseau IANA devra remplacer cette conversion
 * plutôt que supposer que le serveur utilise l'heure du navigateur.
 */
export function parseMadagascarScheduledTime(value: string, now = new Date()): string {
  const match = MADAGASCAR_TIME.exec(value);
  if (!match) throw new Error("Date et heure de programmation invalides.");
  const date = new Date(`${match[1]}T${match[2]}:${match[3]}:00+03:00`);
  if (!Number.isFinite(date.getTime()) ||
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Indian/Antananarivo",
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hourCycle: "h23",
      }).formatToParts(date).filter((p) => ["year","month","day","hour","minute"].includes(p.type))
        .map((p) => p.value).join("") !==
      `${match[1].replaceAll("-","")}${match[2]}${match[3]}`) {
    throw new Error("Date et heure de programmation invalides.");
  }
  if (date.getTime() < now.getTime() + 5 * 60000 ||
      date.getTime() > now.getTime() + 365 * 86400000) {
    throw new Error("Programmer l'envoi entre 5 minutes et 365 jours à l'avance.");
  }
  return date.toISOString();
}

export function validateScheduledContent(
  value: { to: string; subject: string; body: string; when: string },
  now = new Date(),
): ScheduledContent {
  const to = parseInternetRecipients(value.to);
  const subject = value.subject.trim();
  const body = value.body.trim();
  if (!subject || subject.length > 180 || !body || body.length > 50000) {
    throw new Error("Objet ou message programmé invalide.");
  }
  return { to, subject, body, scheduledAt: parseMadagascarScheduledTime(value.when, now) };
}

export function madagascarCivilDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Indian/Antananarivo",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Retourne uniquement les préavis dont la date d'exécution EST aujourd'hui.
 * Les anciennes échéances ne sont jamais rattrapées par une campagne tardive.
 */
export function dueBillingPreavis(input: {
  today: string;
  billingDate: string;
  contractStatus: string;
  rules: readonly PreavisRule[];
  companyName: string;
  customerName: string;
  serviceName: string;
  recipient: string;
  alreadyIssued?: boolean;
}) {
  const email = normalizeInternetAddress(input.recipient);
  return planBillingPreavis({
    billingDate: input.billingDate, contractStatus: input.contractStatus,
    rules: input.rules, asOfDate: input.today,
    alreadyIssued: input.alreadyIssued,
  }).filter((event) => event.scheduledDate === input.today).map((event) => ({
    ...event,
    recipient: email,
    ...renderBillingPreavis({
      companyName: input.companyName,
      customerName: input.customerName,
      serviceName: input.serviceName,
      billingDate: input.billingDate,
      tone: event.tone,
    }),
  }));
}
