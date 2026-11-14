import { normalizeInternetAddress } from "./internet-resend";

const DOMAIN_RE = /^(?=.{4,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
const PROVIDER_ID = /^[A-Za-z0-9_-]{5,128}$/;

export function normalizeMGMailDomain(input: string): string {
  const domain = input.trim().toLowerCase();
  if (!DOMAIN_RE.test(domain) || domain.includes("..") ||
      domain.endsWith(".mail") || domain.endsWith(".mgmail") ||
      domain.split(".").some((part) => part.length > 63)) {
    throw new Error("Nom de domaine public invalide ou réservé à MGMail interne.");
  }
  return domain;
}

export function publicAddressDomain(input: string): string {
  const address = normalizeInternetAddress(input);
  return normalizeMGMailDomain(address.split("@")[1]);
}

type ResendDomain = {
  id?: unknown;
  name?: unknown;
  status?: unknown;
  capabilities?: { sending?: unknown; receiving?: unknown };
  records?: Array<{ record?: unknown; type?: unknown; status?: unknown }>;
};

export type ProviderDomainProof = {
  domain: string;
  providerDomainId: string;
  sendingVerified: boolean;
  receivingVerified: boolean;
};

/** Vérification lecture seule : aucune commande de création ou de changement DNS. */
export async function inspectResendDomain(
  apiKey: string,
  providerDomainId: string,
  expectedDomain: string,
  transport: typeof fetch = fetch,
): Promise<ProviderDomainProof> {
  const domain = normalizeMGMailDomain(expectedDomain);
  if (!apiKey || !PROVIDER_ID.test(providerDomainId)) {
    throw new Error("Fournisseur MGMail non configuré ou domaine fournisseur invalide.");
  }
  const response = await transport(
    `https://api.resend.com/domains/${encodeURIComponent(providerDomainId)}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
    },
  );
  if (!response.ok) {
    throw new Error(`Impossible de vérifier le domaine auprès du fournisseur (HTTP ${response.status}).`);
  }
  const body = await response.json() as ResendDomain;
  if (body.id !== providerDomainId || body.name !== domain ||
      !Array.isArray(body.records)) {
    throw new Error("Le fournisseur n'a pas confirmé l'identité exacte du domaine.");
  }
  // Resend returns TWO records labelled "SPF" (TXT and MX): the
  // SPF-labelled MX is for the sending/return-path service, NOT evidence
  // of an inbound MX. Verify by name AND DNS type, not by label alone.
  const records = body.records.map((record) => ({
    label: String(record.record || "").toLowerCase(),
    type: String(record.type || "").toUpperCase(),
    verified: record.status === "verified",
  }));
  const hasVerified = (label: string, type: string) =>
    records.some((record) => record.label === label &&
      record.type === type && record.verified);
  const sendingSpfRecords = records.filter((record) => record.label === "spf");
  const spfOK = hasVerified("spf", "TXT") &&
    sendingSpfRecords.every((record) => record.verified);
  const dkimOK = hasVerified("dkim", "TXT");
  const inboundMX = records.some((record) =>
    record.type === "MX" &&
    ["receiving", "mx"].includes(record.label) &&
    record.verified);
  // Never confuse partially_verified with a fully verified domain.
  const fullyVerified = body.status === "verified";
  const sendingVerified = fullyVerified &&
    body.capabilities?.sending === "enabled" && dkimOK && spfOK;
  const receivingVerified = fullyVerified &&
    body.capabilities?.receiving === "enabled" && inboundMX;
  return {
    domain,
    providerDomainId,
    sendingVerified: Boolean(sendingVerified),
    receivingVerified: Boolean(receivingVerified),
  };
}

export function assertMGMailActivation(
  expectedAddress: string,
  proof: ProviderDomainProof,
  receive: boolean,
): void {
  if (publicAddressDomain(expectedAddress) !== proof.domain ||
      !proof.sendingVerified || (receive && !proof.receivingVerified)) {
    throw new Error("Activation impossible : domaine et capacités d'envoi/réception non vérifiés.");
  }
}
