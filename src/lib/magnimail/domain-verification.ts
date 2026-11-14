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
  records?: Array<{ record?: unknown; status?: unknown }>;
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
  const verifiedRecords = new Set(
    body.records.filter((record) => record.status === "verified")
      .map((record) => String(record.record).toLowerCase()),
  );
  // Fail closed. A provider domain merely created or 'partially_verified'
  // is NOT proof that sending and receiving are both fully operational.
  const fullyVerified = body.status === "verified";
  const sendingVerified = fullyVerified &&
    body.capabilities?.sending === "enabled" &&
    verifiedRecords.has("dkim") && verifiedRecords.has("spf");
  const receivingVerified = fullyVerified &&
    body.capabilities?.receiving === "enabled" &&
    verifiedRecords.has("receiving");
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
