/**
 * Référentiel central des unités de facturation MAGNISA.
 *
 * Ce fichier ne modifie pas automatiquement les données historiques.
 * Les valeurs `value` sont des identifiants applicatifs stables.
 */
export const BILLING_UNITS = [
  { value: "forfait", label: "Forfait" },
  { value: "unite", label: "Unité" },
  { value: "heure", label: "Heure" },
  { value: "demi_journee", label: "Demi-journée" },
  { value: "jour", label: "Jour" },
  { value: "nuitee", label: "Nuitée" },
  { value: "semaine", label: "Semaine" },
  { value: "mois", label: "Mois" },
  { value: "annee", label: "Année" },
  { value: "minute", label: "Minute" },
  { value: "seance", label: "Séance" },
  { value: "intervention", label: "Intervention" },
  { value: "trajet", label: "Trajet" },
  { value: "colis", label: "Colis" },
  { value: "personne", label: "Personne" },
  { value: "dossier", label: "Dossier" },
  { value: "m2", label: "m²" },
] as const;

export type BillingUnit = (typeof BILLING_UNITS)[number]["value"];

const unitSet = new Set<string>(BILLING_UNITS.map((unit) => unit.value));

export function isBillingUnit(value: unknown): value is BillingUnit {
  return typeof value === "string" && unitSet.has(value);
}

export function getBillingUnitLabel(value: BillingUnit): string {
  return BILLING_UNITS.find((unit) => unit.value === value)!.label;
}

/**
 * Normalise une valeur historique connue vers un identifiant stable.
 * Les valeurs inconnues sont refusées : elles doivent être examinées et
 * mappées explicitement, jamais transformées silencieusement.
 */
const LEGACY_UNIT_MAP: Record<string, BillingUnit> = {
  forfait: "forfait",
  package: "forfait",
  unite: "unite",
  unité: "unite",
  unit: "unite",
  heure: "heure",
  heures: "heure",
  hour: "heure",
  demi_journee: "demi_journee",
  "demi-journée": "demi_journee",
  jour: "jour",
  jours: "jour",
  day: "jour",
  nuitee: "nuitee",
  "nuitée": "nuitee",
  nuit: "nuitee",
  semaine: "semaine",
  week: "semaine",
  mois: "mois",
  month: "mois",
  annee: "annee",
  année: "annee",
  year: "annee",
  minute: "minute",
  minutes: "minute",
  seance: "seance",
  séance: "seance",
  intervention: "intervention",
  trajet: "trajet",
  colis: "colis",
  personne: "personne",
  dossier: "dossier",
  "m²": "m2",
  m2: "m2",
};

export function mapLegacyBillingUnit(value: string): BillingUnit | null {
  return LEGACY_UNIT_MAP[value.trim().toLocaleLowerCase("fr-FR")] ?? null;
}
