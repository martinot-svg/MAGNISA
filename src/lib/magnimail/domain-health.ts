import { inspectResendDomain } from "./domain-verification";

const MAX_DOMAIN_AGE_MS = 36 * 60 * 60 * 1000;
const FUTURE_CLOCK_TOLERANCE_MS = 5 * 60 * 1000;

type DomainProof = {
  id: string;
  organization_id: string;
  domain_name: string;
  provider: string;
  ownership_approved: boolean;
  sending_verified: boolean;
  receiving_verified: boolean;
  provider_checked_at: string;
};

type SenderIdentity = {
  status: string;
  provider: string;
  organization_id: string;
  verified_domain_id: string | null;
  email_address: string;
};

type DomainDb = {
  from(table: string): any;
};

/** A stale proof is NOT a perpetual authorization to send. */
export function domainProofAllowsMail(
  identity: SenderIdentity,
  domain: DomainProof | null,
  receive: boolean,
  now = new Date(),
): boolean {
  if (!domain || identity.status !== "active" || identity.provider !== "resend" ||
      domain.provider !== identity.provider ||
      !identity.verified_domain_id || domain.id !== identity.verified_domain_id ||
      domain.organization_id !== identity.organization_id ||
      identity.email_address.split("@")[1] !== domain.domain_name ||
      !domain.ownership_approved || !domain.sending_verified ||
      (receive && !domain.receiving_verified)) return false;

  const checkedAt = Date.parse(domain.provider_checked_at);
  const age = now.getTime() - checkedAt;
  return Number.isFinite(checkedAt) && age >= -FUTURE_CLOCK_TOLERANCE_MS &&
    age <= MAX_DOMAIN_AGE_MS;
}

export async function checkMGMailIdentityReadiness(
  admin: DomainDb,
  identity: SenderIdentity,
  receive = false,
  now = new Date(),
): Promise<boolean> {
  if (!identity.verified_domain_id || identity.status !== "active") return false;
  const { data, error } = await admin.from("mgmail_verified_domains")
    .select("id,organization_id,domain_name,provider,ownership_approved,sending_verified,receiving_verified,provider_checked_at")
    .eq("id", identity.verified_domain_id)
    .eq("organization_id", identity.organization_id)
    .maybeSingle();
  if (error) return false;
  return domainProofAllowsMail(identity, data, receive, now);
}

type DomainRow = DomainProof & { provider_domain_id: string };

/** Read-only at provider; writes only the latest verification result to DB. */
export async function reconcileMGMailDomains(options: {
  admin: DomainDb;
  apiKey: string | undefined;
  now?: Date;
  transport?: typeof fetch;
  limit?: number;
}) {
  if (!options.apiKey) {
    return { checked: 0, confirmed: 0, degraded: 0, unavailable: 0, enabled: false };
  }
  const now = options.now ?? new Date();
  const limit = Math.max(1, Math.min(options.limit ?? 20, 20));
  const result = await options.admin.from("mgmail_verified_domains")
    .select("id,organization_id,domain_name,provider,provider_domain_id,ownership_approved,sending_verified,receiving_verified,provider_checked_at")
    .eq("provider", "resend")
    .order("provider_checked_at", { ascending: true })
    .limit(limit);
  if (result.error) throw new Error("Impossible de consulter les domaines MGMail.");
  const tally = { checked: 0, confirmed: 0, degraded: 0, unavailable: 0, enabled: true };
  for (const domain of (result.data ?? []) as DomainRow[]) {
    let proof;
    try {
      proof = await inspectResendDomain(
        options.apiKey, domain.provider_domain_id, domain.domain_name,
        options.transport ?? fetch,
      );
    } catch {
      // Do NOT mark network errors as proven loss of DNS. The freshness
      // guard independently refuses mail after the verification expires.
      tally.unavailable++;
      continue;
    }
    const before = domain.sending_verified && domain.receiving_verified;
    const after = proof.sendingVerified && proof.receivingVerified;
    const updated = await options.admin.from("mgmail_verified_domains").update({
      sending_verified: proof.sendingVerified,
      receiving_verified: proof.receivingVerified,
      provider_checked_at: now.toISOString(),
    }).eq("id", domain.id).eq("organization_id", domain.organization_id)
      .eq("provider_domain_id", domain.provider_domain_id)
      .select("id").maybeSingle();
    if (updated.error || !updated.data) {
      throw new Error("La mise à jour du contrôle fournisseur MGMail a échoué.");
    }
    tally.checked++;
    if (before && !after) tally.degraded++;
    else if (after) tally.confirmed++;
  }
  return tally;
}
