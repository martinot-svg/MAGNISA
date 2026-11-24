import type { ServiceUnit } from "./types";

export const SERVICE_UNITS: readonly ServiceUnit[] = [
  { code: "HOUR", label: "Heure", symbol: "h", description: "Une période de 60 minutes." },
  { code: "NIGHT", label: "Nuit", symbol: "nuit", description: "Une nuit d'hébergement ou de service." },
  { code: "DAY", label: "Jour", symbol: "j", description: "Une journée, selon la durée définie au contrat." },
  { code: "HALF_DAY", label: "Demi-journée", symbol: "½ j", description: "Une demi-journée, selon les horaires convenus." },
  { code: "WEEK", label: "Semaine", symbol: "sem.", description: "Une période de sept jours consécutifs." },
  { code: "MONTH", label: "Mois", symbol: "mois", description: "Un mois calendaire ou une période contractuelle mensuelle." },
  { code: "PACKAGE", label: "Forfait", symbol: "forfait", description: "Un prix global indépendant d'une durée unitaire." },
] as const;

export function getServiceUnit(code: string): ServiceUnit | undefined {
  return SERVICE_UNITS.find((unit) => unit.code === code);
}
