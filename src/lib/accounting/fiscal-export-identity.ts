export type FiscalExportIdentity = {
  address: string;
  country: string;
  locality: string;
  legalForm: string;
  primaryActivity: string;
  sector: string;
  taxId: string;
  statId: string;
  registryId: string;
  incomeTaxRegime: string;
  vatStatus: string;
  fiscalProfileConfirmed: string;
  fiscalProfileSource: string;
  currency: string;
  generatedAt: string;
};

type FiscalExportOrganization = Record<string, unknown> | null | undefined;

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : fallback;
}

/**
 * Normalizes declared organization and fiscal metadata shared by PDF/XLSX exports.
 * Missing values stay explicit; this helper never infers legal or tax information.
 */
export function buildFiscalExportIdentity(
  organization: FiscalExportOrganization,
  currency: string,
  generatedAt: string,
): FiscalExportIdentity {
  const org = organization ?? {};
  const profile = asRecord(org.onboarding_profile);

  return {
    address: asText(org.address, "Non renseignée"),
    country: asText(profile.country, "Non renseigné"),
    locality: asText(profile.localityName, "Non renseignée"),
    legalForm: asText(profile.legalForm, "Non renseignée"),
    primaryActivity: asText(profile.primaryActivity, "Non renseignée"),
    sector: asText(org.activity_sector, asText(profile.sectorCode, "Non renseigné")),
    taxId: asText(org.tax_id, "Non renseigné"),
    statId: asText(org.stat_id, "Non renseigné"),
    registryId: asText(org.registry_id, "Non renseigné"),
    incomeTaxRegime: asText(org.income_tax_regime, "À confirmer"),
    vatStatus: asText(org.vat_status, "À confirmer"),
    fiscalProfileConfirmed: org.fiscal_profile_confirmed === true ? "Oui" : "Non — à confirmer",
    fiscalProfileSource: asText(org.fiscal_profile_source, "Non renseignée"),
    currency: asText(currency, "MGA"),
    generatedAt: asText(generatedAt, "Non disponible"),
  };
}
