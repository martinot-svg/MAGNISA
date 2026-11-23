import { describe, expect, it } from "vitest";
import { buildFiscalExportIdentity } from "./fiscal-export-identity";

describe("buildFiscalExportIdentity", () => {
  it("normalizes declared legal and tax identity for both export formats", () => {
    expect(buildFiscalExportIdentity({
      address: "  12 rue de la Paix  ",
      activity_sector: "Services",
      tax_id: "NIF-123",
      stat_id: "STAT-456",
      registry_id: "RCS-789",
      income_tax_regime: "IS",
      vat_status: "Assujetti",
      fiscal_profile_confirmed: true,
      fiscal_profile_source: "Onboarding validé",
      onboarding_profile: {
        country: "Madagascar",
        localityName: "Antananarivo",
        legalForm: "SARL",
        primaryActivity: "Conseil",
        sectorCode: "Services aux entreprises",
      },
    }, "MGA", "2026-11-23T10:00:00.000Z")).toEqual({
      address: "12 rue de la Paix",
      country: "Madagascar",
      locality: "Antananarivo",
      legalForm: "SARL",
      primaryActivity: "Conseil",
      sector: "Services",
      taxId: "NIF-123",
      statId: "STAT-456",
      registryId: "RCS-789",
      incomeTaxRegime: "IS",
      vatStatus: "Assujetti",
      fiscalProfileConfirmed: "Oui",
      fiscalProfileSource: "Onboarding validé",
      currency: "MGA",
      generatedAt: "2026-11-23T10:00:00.000Z",
    });
  });

  it("keeps missing, blank and malformed profile data explicit instead of inferring values", () => {
    expect(buildFiscalExportIdentity({
      address: " ",
      tax_id: null,
      fiscal_profile_confirmed: "true",
      onboarding_profile: "invalid",
    }, "", "")).toEqual({
      address: "Non renseignée",
      country: "Non renseigné",
      locality: "Non renseignée",
      legalForm: "Non renseignée",
      primaryActivity: "Non renseignée",
      sector: "Non renseigné",
      taxId: "Non renseigné",
      statId: "Non renseigné",
      registryId: "Non renseigné",
      incomeTaxRegime: "À confirmer",
      vatStatus: "À confirmer",
      fiscalProfileConfirmed: "Non — à confirmer",
      fiscalProfileSource: "Non renseignée",
      currency: "MGA",
      generatedAt: "Non disponible",
    });
  });

  it("uses the declared profile sector only when the organization sector is absent", () => {
    expect(buildFiscalExportIdentity({
      onboarding_profile: { sectorCode: "Agriculture" },
    }, "MGA", "2026-11-23T10:00:00.000Z").sector).toBe("Agriculture");
  });
});
