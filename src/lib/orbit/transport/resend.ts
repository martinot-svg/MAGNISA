import { createHmac, timingSafeEqual } from "node:crypto";
import { normalizeHeaderFrom, normalizePublicEmail } from "./address";
import type { IncomingInternetMessage, InternetTransport, OutgoingInternetMessage } from "./types";

const SEND_ENDPOINT = "https://api.resend.com/emails";
const RECEIVING_ENDPOINT = "https://api.resend.com/emails/receiving/";

export function verifyResendSignedEvent(
  rawBody: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  signingSecret: string,
  nowMilliseconds = Date.now(),
): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature
    || !/^\d{10}$/.test(timestamp)
    || Math.abs(nowMilliseconds-Number(timestamp)*1000)>300000
    || !/^whsec_[A-Za-z0-9+/=_-]+$/.test(signingSecret)) return false;
  let key: Buffer;
  try {
    key = Buffer.from(signingSecret.slice(6),"base64");
    if (key.length < 16) return false;
  } catch { return false; }
  const expected = createHmac("sha256",key)
    .update(`${id}.${timestamp}.${rawBody}`).digest();
  return signature.split(" ").some(candidate => {
    if (!candidate.startsWith("v1,")) return false;
    const encoded = candidate.slice(3);
    if (!/^[A-Za-z0-9+/=]+$/.test(encoded)) return false;
    const actual = Buffer.from(encoded,"base64");
    return actual.length === expected.length && timingSafeEqual(actual,expected);
  });
}

/** Backend-only provider adapter, never direct from a browser or public endpoint. */
export class ResendInternetTransport implements InternetTransport {
  readonly provider = "resend" as const;
  constructor(private readonly apiKey: string, private readonly fetcher: typeof fetch = fetch) {}

  async send(message: OutgoingInternetMessage) {
    if (!this.apiKey.trim()) throw new Error("Fournisseur de courrier externe non configuré.");
    const from = normalizePublicEmail(message.from);
    if (message.to.length < 1 || message.to.length > 10) {
      throw new Error("Destinataires de courrier externe invalides.");
    }
    const to = message.to.map(normalizePublicEmail);
    if (new Set(to).size !== to.length) {
      throw new Error("Les destinataires externes ne peuvent pas être répétés.");
    }
    const subject = message.subject.trim();
    if (!subject || subject.length > 180 || message.text.length < 1
        || message.text.length > 50000
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(message.requestId)) {
      throw new Error("Message ou clé de déduplication invalide.");
    }
    const response=await this.fetcher(SEND_ENDPOINT,{
      method:"POST",
      headers:{
        Authorization:`Bearer ${this.apiKey}`,
        "Content-Type":"application/json",
        "Idempotency-Key":`orbit-${message.requestId}`,
      },
      body:JSON.stringify({from,to,subject,text:message.text}),
      signal:AbortSignal.timeout(18000),
    });
    if (!response.ok) throw new Error(`Fournisseur externe : envoi refusé (HTTP ${response.status}).`);
    const payload=await response.json() as {id?:unknown};
    if (typeof payload.id !== "string" || !payload.id.trim()) {
      throw new Error("Le fournisseur n'a pas confirmé l'acceptation du message.");
    }
    return {
      provider:this.provider, providerMessageId:payload.id, state:"accepted" as const,
    };
  }

  async fetchReceived(messageId: string): Promise<IncomingInternetMessage> {
    if (!this.apiKey.trim() || !/^[a-zA-Z0-9_-]{5,128}$/.test(messageId)) {
      throw new Error("Réception de courrier Internet non configurée ou ID invalide.");
    }
    const response = await this.fetcher(RECEIVING_ENDPOINT+encodeURIComponent(messageId),{
      headers:{Authorization:`Bearer ${this.apiKey}`},
      signal:AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`Impossible de récupérer le courrier entrant (HTTP ${response.status}).`);
    const payload=await response.json() as {
      from?: unknown; to?: unknown; subject?: unknown; text?: unknown;
    };
    if (typeof payload.from !== "string" || !Array.isArray(payload.to)) {
      throw new Error("Réponse du fournisseur invalide.");
    }
    const from=normalizeHeaderFrom(payload.from);
    const to=payload.to.filter((x):x is string=>typeof x === "string").map(normalizePublicEmail);
    if (!to.length || to.length > 50) throw new Error("Destinataires entrants invalides.");
    const subject=typeof payload.subject==="string"?payload.subject.trim().slice(0,180):"";
    const text=typeof payload.text==="string"?payload.text.slice(0,50000):"";
    return {from,to,subject:subject||"(Sans objet)",text};
  }
}
