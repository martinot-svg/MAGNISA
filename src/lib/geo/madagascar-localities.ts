import entries from "@/data/madagascar-localities.json";
import { REGISTRATION_REGIONS } from "@/lib/auth/magnisa-identity";

// Source: raherygino/madagascar-data (MIT, 2018), reconciled to the
// 24-region geography; this is a suggestion catalogue, not a legal registry.
type LocalityRow = [name: string, commune: string, district: string, regionCode: string];
export type LocalitySuggestion = {
  ref: string;
  name: string;
  commune: string;
  district: string;
  type: "fokontany" | "commune";
};
const rows = entries as LocalityRow[];
const normalize = (value: string) => value.normalize("NFD")
  .replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[-']/g," ")
  .replace(/\s+/g," ").trim();

export function resolveLocality(ref: string, regionCode: string): LocalitySuggestion | null {
  const match = /^(f|c):(\d{1,6})$/.exec(ref);
  if (!match || !REGISTRATION_REGIONS.some(r => r.code === regionCode)) return null;
  const index = Number(match[2]);
  if (!Number.isSafeInteger(index) || index < 0 || index >= rows.length) return null;
  const [place, commune, district, code] = rows[index];
  if (code !== regionCode) return null;
  const isCommune = match[1] === "c";
  return {
    ref,
    name: isCommune ? commune : place,
    commune,
    district,
    type: isCommune ? "commune" : "fokontany",
  };
}

export function suggestMadagascarLocalities(regionCode: string, query: string, limit = 12): LocalitySuggestion[] {
  if (!REGISTRATION_REGIONS.some(r => r.code === regionCode)) return [];
  const q = normalize(query.slice(0,80));
  if (q.length < 2) return [];
  const matches: Array<{ value: LocalitySuggestion; rank: number }> = [];
  const seenCommunes = new Set<string>();
  rows.forEach(([name, commune, district, code], index) => {
    if (code !== regionCode) return;
    const communeKey = normalize(commune + "|" + district);
    const communeName = normalize(commune);
    if (!seenCommunes.has(communeKey)) {
      seenCommunes.add(communeKey);
      if (communeName.includes(q)) matches.push({
        value: { ref:`c:${index}`, name: commune, commune, district, type:"commune" },
        rank: communeName === q ? 0 : communeName.startsWith(q) ? 1 : 3,
      });
    }
    const placeName = normalize(name);
    if (placeName.includes(q)) matches.push({
      value: { ref:`f:${index}`, name, commune, district, type:"fokontany" },
      rank: placeName === q ? 0 : placeName.startsWith(q) ? 2 : 4,
    });
  });
  matches.sort((a,b)=>a.rank-b.rank || a.value.name.localeCompare(b.value.name,"fr") ||
    a.value.district.localeCompare(b.value.district,"fr"));
  return matches.slice(0,Math.max(1,Math.min(limit,20))).map(row=>row.value);
}
