/**
 * Magnibox TLD catalogue: the DNS root (IANA) is authoritative for TLDs.
 * NIC.MG is authoritative for descriptive second-level registration zones.
 * Neither root delegation nor DNS existence is evidence of registration availability.
 */
import { domainToASCII } from "node:url";

export const IANA_TLD_URL = "https://data.iana.org/TLD/tlds-alpha-by-domain.txt";
export const NIC_MG_POLICY = "https://nic.mg/wp-content/uploads/2025/04/Charte-de-nommage-du-MG-I-Domaine-name-charter-of-MG.pdf";
export type TldCategory = "madagascar"|"international"|"professionnel"|"technologie"|"creation"|"finance"|"commerce"|"sectoriel"|"national"|"autre";
export type TldStatus = "non_verifie"|"restreint"|"desactive";
export type TldEntry = {
  suffix: string; type: "tld"|"suffixe_compose"; category: TldCategory;
  country: string|null; registry: string|null; eligibility: string;
  status: TldStatus; registrationAvailability: "non_verifiee";
  source: string; lastVerifiedAt: string|null;
};
const groupStrings: Record<Exclude<TldCategory,"madagascar"|"national"|"autre">,string> = {
  international:"com net org info biz pro online site website email xyz top space",
  professionnel:"company business agency consulting services solutions partners management group international enterprises ventures works",
  technologie:"tech technology digital dev app software systems network cloud hosting computer codes engineering security data",
  creation:"marketing media design studio art photography graphics video social events content",
  finance:"finance financial accountant accountants money capital fund tax cash",
  commerce:"store shop shopping market sale retail boutique trade",
  sectoriel:"education school university training health medical clinic legal law construction architecture travel restaurant hotel transport logistics energy farm foundation"
};
const categories = new Map<string,TldCategory>();
for (const [category,names] of Object.entries(groupStrings)) {
  for (const tld of names.split(" ")) categories.set(tld,category as TldCategory);
}
const mgRules: Record<string,string> = {
  "mg":"Enregistrement selon les règles générales de NIC.MG.",
  "com.mg":"Destiné aux organismes à caractère commercial (charte NIC.MG, article 5).",
  "co.mg":"Destiné aux organismes à caractère commercial (charte NIC.MG, article 5).",
  "org.mg":"Destiné aux organisations et associations (charte NIC.MG, article 5).",
  "edu.mg":"Destiné aux universités et établissements d’enseignement (charte NIC.MG, article 5).",
  "gov.mg":"Réservé aux organismes gouvernementaux (charte NIC.MG, article 5).",
  "mil.mg":"Réservé aux services de l’armée et de la défense nationale (charte NIC.MG, article 5).",
  "nom.mg":"Destiné aux personnes physiques (charte NIC.MG, article 5).",
  "prd.mg":"Destiné aux projets de développement (charte NIC.MG, article 5).",
  "tm.mg":"Destiné aux marques de fabrique (charte NIC.MG, article 5).",
  "net.mg":"Suffixe demandé, mais non confirmé dans la liste descriptive de la charte NIC.MG : consulter le registre."
};
export const MG_SUFFIXES = Object.keys(mgRules);
export function parseIanaTlds(text: string): string[] {
  if (!/^# Version \d{8,}/m.test(text)) throw new Error("Format ou version IANA invalide.");
  const tlds = text.split(/\r?\n/).map(s=>s.trim().toLowerCase())
    .filter(s=>s && !s.startsWith("#"));
  if (tlds.length < 1000 || !tlds.includes("mg") || !tlds.includes("com"))
    throw new Error("Catalogue IANA incomplet.");
  if (tlds.some(t=>!/^([a-z0-9-]{2,63}|xn--[a-z0-9-]+)$/.test(t)))
    throw new Error("Un TLD IANA possède un format inconnu.");
  return [...new Set(tlds)].sort();
}
export function buildTldCatalog(tlds: string[]): TldEntry[] {
  const delegated = new Set(tlds);
  const result: TldEntry[] = tlds.map(tld => ({
    suffix:"."+tld,type:"tld" as const,
    category:(tld==="mg"?"madagascar":categories.get(tld)||(tld.length===2?"national":"autre")) as TldCategory,
    country:tld.length===2?tld.toUpperCase():null,
    registry:tld==="mg"?"NIC.MG":null,
    eligibility:tld==="mg"?mgRules.mg:"Conditions du registre à vérifier avant toute inscription.",
    status:"non_verifie" as const, registrationAvailability:"non_verifiee" as const,
    source:tld==="mg"?NIC_MG_POLICY:IANA_TLD_URL,lastVerifiedAt:null as string | null
  }));
  if (delegated.has("mg")) for (const suffix of MG_SUFFIXES.filter(x=>x!=="mg")) {
    result.push({
      suffix:"."+suffix,type:"suffixe_compose",category:"madagascar",country:"MG",registry:"NIC.MG",
      eligibility:mgRules[suffix],status: suffix==="net.mg"?"non_verifie":"restreint",
      registrationAvailability:"non_verifiee",source:NIC_MG_POLICY,lastVerifiedAt:null as string | null
    });
  }
  return result.sort((a,b)=>a.suffix.localeCompare(b.suffix));
}
export async function fetchOfficialTldCatalog(fetcher: typeof fetch = fetch): Promise<TldEntry[]> {
  const response = await fetcher(IANA_TLD_URL,{signal:AbortSignal.timeout(8000),next:{revalidate:86400}});
  if (!response.ok) throw new Error("La liste officielle des extensions IANA est indisponible.");
  return buildTldCatalog(parseIanaTlds(await response.text()));
}
export function getMatchingSuffix(domain: string, catalog: TldEntry[]): TldEntry {
  const value = domainToASCII(domain.trim().toLowerCase());
  if (!value || value.length>253 || value.endsWith(".") || /[^a-z0-9.-]/.test(value)) throw new Error("Domaine invalide.");
  const labels=value.split(".");
  if (labels.length<2 || labels.some(s=>s.length<1||s.length>63||!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(s))) throw new Error("Domaine invalide.");
  const matched=catalog.filter(row=>value.endsWith(row.suffix) && value.length>row.suffix.length);
  if (!matched.length) throw new Error("Extension absente du catalogue officiel ou non confirmée.");
  return matched.sort((a,b)=>b.suffix.length-a.suffix.length)[0];
}
