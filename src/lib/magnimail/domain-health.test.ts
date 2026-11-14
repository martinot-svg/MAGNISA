import { describe, expect, it, vi } from "vitest";
import {
  domainProofAllowsMail,
  reconcileMGMailDomains,
  checkMGMailIdentityReadiness,
} from "./domain-health";

const NOW = new Date("2026-11-14T08:00:00.000Z");
const domain = {
  id: "d_1", organization_id: "org_1", domain_name: "mitalia.digital",
  provider: "resend", provider_domain_id: "domain_verified_123",
  ownership_approved: true, sending_verified: true, receiving_verified: true,
  provider_checked_at: "2026-11-14T07:00:00.000Z",
};
const identity = {
  status: "active", provider: "resend", organization_id: "org_1",
  verified_domain_id: "d_1", email_address: "finance@mitalia.digital",
};

describe("MGMail — preuve DNS actualisée", () => {
  it("autorise seulement un expéditeur dont le domaine vérifié est récent", () => {
    expect(domainProofAllowsMail(identity, domain, true, NOW)).toBe(true);
    expect(domainProofAllowsMail(identity, { ...domain, sending_verified: false }, false, NOW)).toBe(false);
    expect(domainProofAllowsMail(identity, { ...domain, receiving_verified: false }, true, NOW)).toBe(false);
    expect(domainProofAllowsMail(identity, { ...domain, receiving_verified: false }, false, NOW)).toBe(true);
    expect(domainProofAllowsMail(identity, { ...domain, provider_checked_at: "2026-11-12T07:00:00Z" }, false, NOW)).toBe(false);
    expect(domainProofAllowsMail(identity, { ...domain, provider_checked_at: "invalid" }, false, NOW)).toBe(false);
    expect(domainProofAllowsMail(identity, { ...domain, provider_checked_at: "2026-11-15T00:00:00Z" }, false, NOW)).toBe(false);
    expect(domainProofAllowsMail({ ...identity, organization_id: "org_2" }, domain, false, NOW)).toBe(false);
    expect(domainProofAllowsMail({ ...identity, email_address: "finance@other.org" }, domain, false, NOW)).toBe(false);
  });

  it("refuse de délivrer un ancien domaine à un autre tenant", async () => {
    const admin = {
      from: (_name: string) => ({
        select() { return this; },
        eq() { return this; },
        maybeSingle: async () => ({ data: domain, error: null }),
      }),
    };
    expect(await checkMGMailIdentityReadiness(admin, identity, true, NOW)).toBe(true);
    expect(await checkMGMailIdentityReadiness(
      admin, { ...identity, organization_id: "org_2" }, true, NOW)).toBe(false);
  });

  it("actualise un DNS valide en lecture seule, sans activer d'identité", async () => {
    const changes: Record<string, unknown>[] = [];
    const fake = {
      from: (_table: string) => {
        const q = {
          select() { return q; },
          eq() { return q; },
          order() { return q; },
          update(change: Record<string, unknown>) { changes.push(change); return q; },
          limit: async () => ({ data: [domain], error: null }),
          maybeSingle: async () => ({ data: { id: domain.id }, error: null }),
        };
        return q;
      },
    };
    const provider = vi.fn<typeof fetch>(async (_url, config) => {
      expect(config?.method).toBe("GET");
      return Response.json({
        id: domain.provider_domain_id, name: domain.domain_name,
        status: "verified", capabilities: { sending: "enabled", receiving: "enabled" },
        records: [
          { record: "DKIM", type: "TXT", status: "verified" },
          { record: "SPF", type: "MX", status: "verified" },
          { record: "SPF", type: "TXT", status: "verified" },
          { record: "Receiving", type: "MX", status: "verified" },
        ],
      });
    });
    const result = await reconcileMGMailDomains({
      admin: fake, apiKey: "test-key", now: NOW, transport: provider,
    });
    expect(result.checked).toBe(1);
    expect(result.confirmed).toBe(1);
    expect(changes).toHaveLength(1);
    expect(changes[0].sending_verified).toBe(true);
    expect(changes[0].receiving_verified).toBe(true);
    expect(changes[0]).not.toHaveProperty("ownership_approved");
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it("ne désactive pas une entreprise sur une panne réseau temporaire", async () => {
    const changes: unknown[] = [];
    const fake = {
      from: (_table: string) => {
        const q = {
          select() { return q; }, eq() { return q; }, order() { return q; },
          update(change: unknown) { changes.push(change); return q; },
          limit: async () => ({ data: [domain], error: null }),
        };
        return q;
      },
    };
    const result = await reconcileMGMailDomains({
      admin: fake, apiKey: "test-key", now: NOW,
      transport: async () => new Response("", { status: 503 }),
    });
    expect(result.unavailable).toBe(1);
    expect(result.checked).toBe(0);
    expect(changes).toHaveLength(0);
    // When the proof expires, the send gate fails closed independently.
    expect(domainProofAllowsMail(
      identity, { ...domain, provider_checked_at: "2026-11-12T07:00:00Z" },
      false, NOW,
    )).toBe(false);
  });

  it("n'utilise aucune clé API absente", async () => {
    const result = await reconcileMGMailDomains({
      admin: { from: () => { throw Error("DB should not be queried"); } },
      apiKey: undefined,
    });
    expect(result.enabled).toBe(false);
    expect(result.checked).toBe(0);
  });
});
