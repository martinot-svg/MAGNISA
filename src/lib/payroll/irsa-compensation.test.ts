import { describe, expect, it } from "vitest";
import { calculateOvertimeIrsa, classifyIrsaCompensation } from "./irsa-compensation";

const datedRule = {
  code: "meal_allowance",
  treatment: "exemption_capped" as const,
  exemptionCap: 50_000,
  legalReference: "CGI art. 01.03.03",
  ruleVersion: "2026.01",
  effectiveFrom: "2026-01-01",
};

describe("Classification fiscale IRSA versionnée", () => {
  it("applique un plafond d'exonération sans rendre tout le montant exonéré", () => {
    const result = classifyIrsaCompensation(
      [{ code: "meal_allowance", amount: 80_000 }],
      [datedRule],
      "2026-03-31",
    );
    expect(result.taxableCompensation).toBe(30_000);
    expect(result.exemptCompensation).toBe(50_000);
  });

  it("refuse une classification absente ou deux règles simultanées", () => {
    expect(() => classifyIrsaCompensation(
      [{ code: "unknown", amount: 10_000 }], [datedRule], "2026-03-31",
    )).toThrow(/absente ou ambiguë/);
    expect(() => classifyIrsaCompensation(
      [{ code: "meal_allowance", amount: 10_000 }],
      [datedRule, { ...datedRule, ruleVersion: "2026.02" }],
      "2026-03-31",
    )).toThrow(/absente ou ambiguë/);
  });

  it("ne permet pas une exonération sans référence et version", () => {
    expect(() => classifyIrsaCompensation(
      [{ code: "meal_allowance", amount: 10_000 }],
      [{ ...datedRule, legalReference: "" }],
      "2026-03-31",
    )).toThrow(/Référence réglementaire/);
  });

  it("calcule l'exonération des 20 premières heures pour un non-cadre avec relevé rapproché", () => {
    const result = calculateOvertimeIrsa({
      totalHours: 25,
      hourlyRate: 2_000,
      premiumRate: 0.3,
      overtimePay: 65_000,
      additionalPremiums: 0,
      isCadre: false,
      timeRecordReconciled: true,
    });
    expect(result.exemptHours).toBe(20);
    expect(result.taxableHours).toBe(5);
    expect(result.exemptAmount).toBe(52_000);
    expect(result.taxableAmount).toBe(13_000);
  });

  it("rejects overtime totals that do not reconcile to hours and premium", () => {
    expect(() => calculateOvertimeIrsa({
      totalHours: 10,
      hourlyRate: 2_000,
      premiumRate: 0.3,
      overtimePay: 25_000,
      additionalPremiums: 0,
      isCadre: false,
      timeRecordReconciled: true,
    })).toThrow(/ne correspond pas aux heures/);
  });

  it("n'applique pas l'exonération aux cadres ni sans relevé rapproché", () => {
    const input = {
      totalHours: 10, hourlyRate: 2_000, premiumRate: 0.3, overtimePay: 26_000,
      isCadre: false, timeRecordReconciled: true,
    };
    expect(calculateOvertimeIrsa({ ...input, isCadre: true }).exemptAmount).toBe(0);
    expect(calculateOvertimeIrsa({ ...input, timeRecordReconciled: false }).exemptAmount).toBe(0);
  });

  it("exclut les autres primes de la quote-part exonérée", () => {
    const result = calculateOvertimeIrsa({
      totalHours: 10, hourlyRate: 2_000, premiumRate: 0.3, overtimePay: 30_000,
      additionalPremiums: 4_000, isCadre: false, timeRecordReconciled: true,
    });
    expect(result.exemptAmount).toBe(26_000);
    expect(result.taxableAmount).toBe(4_000);
  });
});
