import { createHmac, timingSafeEqual } from "node:crypto";

const ADDRESS_RE = /^[a-z0-9][a-z0-9.!#$%&'*+/=?^_`{|}~-]*@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i;

export function normalizeInternetAddress(input: string): string {
  const value = input.trim().toLowerCase();
  if (value.length > 254 || value.includes("\r") || value.includes("\n") ||
      !ADDRESS_RE.test(value) || value.includes("..")) {
    throw new Error("Adresse Internet invalide.");
  }
  return value;
}

export function parseInternetRecipients(input: string): string[] {
  if (input.length > 2000) throw new Error("Liste de destinataires trop longue.");
  const addresses = input.split(/[;,]/).map((s) => s.trim()).filter(Boolean);
  if (addresses.length < 1 || addresses.length > 10) {
    throw new Error("MGMail accepte entre 1 et 10 destinataires par message.");
  }
  const normalized = addresses.map(normalizeInternetAddress);
  if (new Set(normalized).size !== normalized.length) {
    throw new Error("Les destinataires ne doivent pas être répétés.");
  }
  return normalized;
}

/** Header From: support@domain.tld OR "Name <support@domain.tld>". */
export function parseIncomingSender(input: string): string {
  const match = input.trim().match(/<([^<>]+)>$/);
  return normalizeInternetAddress(match ? match[1] : input);
}

export function verifyResendWebhookSignature(
  body: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  signingSecret: string,
  nowMilliseconds = Date.now(),
): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature ||
      !/^\d{10}$/.test(timestamp) ||
      Math.abs(nowMilliseconds - Number(timestamp) * 1000) > 300000 ||
      !/^whsec_[A-Za-z0-9+/=_-]+$/.test(signingSecret)) return false;

  let key: Buffer;
  try {
    key = Buffer.from(signingSecret.slice(6), "base64");
    if (key.length < 16) return false;
  } catch {
    return false;
  }
  const expected = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${body}`).digest();
  return signature.split(" ").some((candidate) => {
    if (!candidate.startsWith("v1,")) return false;
    const encoded = candidate.slice(3);
    if (!/^[A-Za-z0-9+/=]+$/.test(encoded)) return false;
    const given = Buffer.from(encoded, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

export async function sendResendInternetEmail(
  input: {
    apiKey: string;
    from: string;
    to: string[];
    subject: string;
    body: string;
    requestId: string;
  },
  transport: typeof fetch = fetch,
): Promise<{ id: string }> {
  if (!input.apiKey.trim()) throw new Error("Service d'envoi externe non configuré.");
  const from = normalizeInternetAddress(input.from);
  if (input.to.length < 1 || input.to.length > 10) {
    throw new Error("Destinataires externes invalides.");
  }
  const to = input.to.map(normalizeInternetAddress);
  if (!input.subject.trim() || input.subject.length > 180 ||
      input.body.length < 1 || input.body.length > 50000 ||
      !/^[0-9a-f-]{36}$/i.test(input.requestId)) {
    throw new Error("Contenu ou identifiant d'envoi invalide.");
  }
  const response = await transport("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `mgmail-${input.requestId}`,
    },
    body: JSON.stringify({ from, to, subject: input.subject, text: input.body }),
    signal: AbortSignal.timeout(18000),
  });
  if (!response.ok) throw new Error(`Fournisseur e-mail : envoi refusé (HTTP ${response.status}).`);
  const result = await response.json() as { id?: unknown };
  if (typeof result.id !== "string" || !result.id.trim()) {
    throw new Error("Le fournisseur n'a pas confirmé l'acceptation du message.");
  }
  return { id: result.id };
}

export async function fetchResendReceivedEmail(
  apiKey: string,
  messageId: string,
  transport: typeof fetch = fetch,
): Promise<{ from: string; to: string[]; subject: string; text: string }> {
  if (!apiKey || !/^[a-zA-Z0-9_-]{5,128}$/.test(messageId)) {
    throw new Error("Réception e-mail non configurée ou identifiant invalide.");
  }
  const response = await transport(
    `https://api.resend.com/emails/receiving/${encodeURIComponent(messageId)}`,
    { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15000) },
  );
  if (!response.ok) throw new Error(`Récupération du message reçue impossible (HTTP ${response.status}).`);
  const data = await response.json() as {
    from?: unknown; to?: unknown; subject?: unknown; text?: unknown;
  };
  if (typeof data.from !== "string" || !Array.isArray(data.to)) {
    throw new Error("Réponse du fournisseur de réception invalide.");
  }
  const from = parseIncomingSender(data.from);
  const to = data.to.filter((v): v is string => typeof v === "string")
    .map(normalizeInternetAddress);
  if (!to.length || to.length > 50) throw new Error("Destinataires entrants invalides.");
  const subject = typeof data.subject === "string"
    ? data.subject.trim().slice(0, 180) : "";
  const text = typeof data.text === "string" ? data.text.slice(0, 50000) : "";
  return { from, to, subject: subject || "(Sans objet)", text };
}
