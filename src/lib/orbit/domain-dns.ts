import { resolveMx, resolveTxt } from "node:dns/promises";
import { normalizeOrbitDomain } from "./domains";

/**
 * Public DNS is the source of truth for domain ownership; the browser must
 * never be allowed to mark a requested domain verified.
 * DNS proof != a working sender, inbox, alias, DKIM signature, or delivery.
 */
export const ORBIT_DNS_PREFIX = "_magnisa-verify";
export function orbitDnsHost(domain: string): string {
  return `${ORBIT_DNS_PREFIX}.${normalizeOrbitDomain(domain)}`;
}
export function orbitDnsValue(token: string): string {
  if (!/^[0-9a-f]{64}$/.test(token)) throw Error("Jeton de vérification invalide.");
  return `magnisa-orbit=${token}`;
}
export function orbitTxtStrings(records: string[][]): string[] {
  // DNS implementations split a single TXT string into fragments.
  return records.map(chunks => chunks.join("").trim());
}
export function isOrbitDomainProof(records: string[][], token: string): boolean {
  const expected = orbitDnsValue(token);
  return orbitTxtStrings(records).some(value => value === expected);
}

export type OrbitDnsStatus = {
  ownership: "confirmed" | "absent" | "unavailable";
  mx: "present" | "absent" | "unavailable";
  spf: "present" | "absent" | "invalid" | "unavailable";
  dmarc: "present" | "absent" | "unavailable";
  dkim: "present" | "absent" | "not_checked" | "unavailable";
};
type OrbitResolveTxt = (host: string) => Promise<string[][]>;
type OrbitResolveMx = (host: string) => Promise<Array<{ exchange: string; priority: number }>>;
export function validateOrbitDkimSelector(input: string): string {
  const selector = input.trim();
  if (!/^[A-Za-z0-9_-]{1,63}$/.test(selector)) {
    throw Error("Sélecteur DKIM invalide (1 à 63 caractères alphanumériques, tiret ou souligné).");
  }
  return selector;
}
async function txtAt(host: string, resolver: OrbitResolveTxt): Promise<{ records: string[][]; unavailable: boolean }> {
  try {
    return { records: await resolver(host), unavailable: false };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "ENODATA" || code === "ENOTFOUND" || code === "NXDOMAIN") {
      return { records: [], unavailable: false };
    }
    return { records: [], unavailable: true };
  }
}

/** Diagnostics only; these results never activate an Internet mailbox. */
export async function diagnoseOrbitDomainDNS(
  domainValue: string,
  token: string,
  selector?: string,
  resolvers: { txt?: OrbitResolveTxt; mx?: OrbitResolveMx } = {},
): Promise<OrbitDnsStatus> {
  const domain = normalizeOrbitDomain(domainValue);
  orbitDnsValue(token);
  const txt = resolvers.txt ?? resolveTxt;
  const mx = resolvers.mx ?? resolveMx;
  const dkimSelector = selector ? validateOrbitDkimSelector(selector) : null;

  const [proof, apex, dmarc, dkim] = await Promise.all([
    txtAt(orbitDnsHost(domain), txt),
    txtAt(domain, txt),
    txtAt(`_dmarc.${domain}`, txt),
    dkimSelector ? txtAt(`${dkimSelector}._domainkey.${domain}`, txt) : Promise.resolve(null),
  ]);
  let mxState: OrbitDnsStatus["mx"] = "unavailable";
  try {
    const entries = await mx(domain);
    // Null MX intentionally signals this domain does not accept any inbound mail.
    mxState = entries.some(entry => entry.exchange && entry.exchange !== ".") ? "present" : "absent";
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    mxState = code === "ENODATA" || code === "ENOTFOUND" || code === "NXDOMAIN" ? "absent" : "unavailable";
  }
  const spf = orbitTxtStrings(apex.records).filter(x => /^v=spf1(?:\s|$)/i.test(x));
  const dm = orbitTxtStrings(dmarc.records);
  return {
    ownership: proof.unavailable ? "unavailable" : isOrbitDomainProof(proof.records,token) ? "confirmed" : "absent",
    mx: mxState,
    spf: apex.unavailable ? "unavailable" : spf.length === 1 ? "present" : spf.length > 1 ? "invalid" : "absent",
    dmarc: dmarc.unavailable ? "unavailable" : dm.some(x => /^v=DMARC1\s*;/i.test(x)) ? "present" : "absent",
    dkim: !dkim ? "not_checked" : dkim.unavailable ? "unavailable" :
      orbitTxtStrings(dkim.records).some(x => /(?:^|;)\s*(?:v=DKIM1;|p=)/i.test(x)) ? "present" : "absent",
  };
}
