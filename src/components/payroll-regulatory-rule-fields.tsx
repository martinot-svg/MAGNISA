"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { compensationOptions, customCompensationCode } from "@/lib/payroll/compensation-options";

type Treatment =
  | "fully_taxable"
  | "fully_exempt"
  | "partially_taxable"
  | "exemption_capped"
  | "conditional"
  | "special";

type CompensationRule = {
  code: string;
  customLabel?: string;
  treatment: Treatment;
  taxableRate?: number;
  exemptionCap?: number;
  conditionKey?: string;
  legalReference: string;
  ruleVersion: string;
  effectiveFrom: string;
  effectiveTo?: string;
};

type OvertimeCategory = "regular" | "night" | "sunday" | "holiday" | "night_holiday";

type OvertimeRule = {
  category: OvertimeCategory;
  premiumPercent: number | "";
  legalReference: string;
  ruleVersion: string;
  effectiveFrom: string;
  effectiveTo?: string;
};

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

const treatments: Array<{ value: Treatment; label: string }> = [
  { value: "fully_taxable", label: "Imposable à 100 %" },
  { value: "fully_exempt", label: "Exonéré à 100 %" },
  { value: "partially_taxable", label: "Partiellement imposable" },
  { value: "exemption_capped", label: "Exonération plafonnée" },
  { value: "conditional", label: "Exonération sous condition" },
  { value: "special", label: "Traitement particulier" },
];


const overtimeCategories: Array<{ value: OvertimeCategory; label: string }> = [
  { value: "regular", label: "Jour ouvrable" },
  { value: "night", label: "Nuit" },
  { value: "sunday", label: "Dimanche" },
  { value: "holiday", label: "Jour férié" },
  { value: "night_holiday", label: "Nuit d'un jour férié" },
];

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="field"><label>{label}</label>{children}</div>;
}

export function PayrollRegulatoryRuleFields({
  compensationRules = [],
  overtimeRules = [],
}: {
  compensationRules?: unknown;
  overtimeRules?: unknown;
}) {
  const [compensation, setCompensation] = useState<CompensationRule[]>(() =>
    asArray<CompensationRule>(compensationRules).map((rule) => ({ ...rule })),
  );
  const [overtime, setOvertime] = useState<OvertimeRule[]>(() =>
    asArray<OvertimeRule>(overtimeRules).map((rule) => ({ ...rule })),
  );

  function updateCompensation(index: number, patch: Partial<CompensationRule>) {
    setCompensation((current) => current.map((rule, i) => i === index ? { ...rule, ...patch } : rule));
  }

  function updateOvertime(index: number, patch: Partial<OvertimeRule>) {
    setOvertime((current) => current.map((rule, i) => i === index ? { ...rule, ...patch } : rule));
  }

  return (
    <div className="section">
      <input type="hidden" name="irsa_compensation_rules" value={JSON.stringify(compensation)} />
      <input type="hidden" name="overtime_premium_rules" value={JSON.stringify(overtime)} />

      <section className="card section">
        <h3>Classification fiscale des rémunérations</h3>
        <p className="muted">Sélectionne la rémunération, définis son traitement fiscal et renseigne la référence officielle ainsi que sa période de validité.</p>
        {compensation.length === 0 && <p className="notice">Aucune classification personnalisée. Ajoute une règle uniquement si ton entreprise utilise un élément de rémunération qui nécessite un traitement fiscal spécifique.</p>}
        {compensation.map((rule, index) => {
          const isCustom = rule.code === "other_custom" || rule.code.startsWith("custom_");
          const selectedValue = isCustom ? "other_custom" : rule.code;
          const usedCodes = compensation.filter((_, i) => i !== index).map((item) => item.code);
          return (
            <div className="card section" key={index}>
              <div className="actions" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <strong>Rémunération {index + 1}</strong>
                <button type="button" className="button" onClick={() => setCompensation((current) => current.filter((_, i) => i !== index))}>Supprimer</button>
              </div>
              <div className="grid2">
                <Field label="Rémunération">
                  <select value={selectedValue} onChange={(e) => {
                    const value = e.target.value;
                    updateCompensation(index, {
                      code: value === "other_custom" ? "other_custom" : value,
                      customLabel: value === "other_custom" ? (rule.customLabel || "") : undefined,
                    });
                  }} required>
                    <option value="">Sélectionner une rémunération</option>
                    {compensationOptions.filter(([value]) => value === "other_custom" || !usedCodes.includes(value) || value === selectedValue).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </Field>
                {isCustom && <Field label="Précise la rémunération">
                  <input value={rule.customLabel || ""} onChange={(e) => updateCompensation(index, {
                    customLabel: e.target.value,
                    code: customCompensationCode(e.target.value),
                  })} placeholder="Ex. Indemnité exceptionnelle" maxLength={120} required />
                </Field>}
                <Field label="Traitement fiscal">
                  <select value={rule.treatment || "fully_taxable"} onChange={(e) => updateCompensation(index, { treatment: e.target.value as Treatment })}>
                    {treatments.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </Field>
                {rule.treatment === "partially_taxable" && (
                  <Field label="Part imposable (%)">
                    <input type="number" min="0" max="100" step="0.01" value={rule.taxableRate === undefined ? "" : rule.taxableRate * 100}
                      onChange={(e) => updateCompensation(index, { taxableRate: e.target.value === "" ? undefined : Number(e.target.value) / 100 })} required />
                  </Field>
                )}
                {rule.treatment === "exemption_capped" && (
                  <Field label="Plafond d'exonération (Ar)">
                    <input type="number" min="0" step="0.01" value={rule.exemptionCap ?? ""}
                      onChange={(e) => updateCompensation(index, { exemptionCap: e.target.value === "" ? undefined : Number(e.target.value) })} required />
                  </Field>
                )}
                {rule.treatment === "conditional" && (
                  <Field label="Condition d'exonération">
                    <input value={rule.conditionKey || ""} onChange={(e) => updateCompensation(index, { conditionKey: e.target.value })} placeholder="Ex. justificatif fourni" required />
                  </Field>
                )}
                {rule.treatment === "special" && (
                  <p className="muted">Le montant imposable de ce traitement particulier doit être déterminé lors de la saisie du bulletin.</p>
                )}
                <Field label="Référence officielle (texte, article, URL)">
                  <input value={rule.legalReference || ""} onChange={(e) => updateCompensation(index, { legalReference: e.target.value })} placeholder="Ex. CGI, article ..." required />
                </Field>
                <Field label="Version de la règle">
                  <input value={rule.ruleVersion || ""} onChange={(e) => updateCompensation(index, { ruleVersion: e.target.value })} placeholder="Ex. Loi de finances 2026" required />
                </Field>
                <Field label="Date d'effet">
                  <input type="date" value={rule.effectiveFrom || ""} onChange={(e) => updateCompensation(index, { effectiveFrom: e.target.value })} required />
                </Field>
                <Field label="Date de fin (facultative)">
                  <input type="date" value={rule.effectiveTo || ""} onChange={(e) => updateCompensation(index, { effectiveTo: e.target.value || undefined })} />
                </Field>
              </div>
            </div>
          );
        })}
        <button type="button" className="button" onClick={() => setCompensation((current) => [...current, {
          code: "", treatment: "fully_taxable", legalReference: "",
          ruleVersion: "", effectiveFrom: "",
        }])}>Ajouter une rémunération</button>
      </section>

      <section className="card section">
        <h3>Majorations des heures supplémentaires</h3>
        <p className="muted">
          Configure les catégories et les taux uniquement à partir d'une source réglementaire vérifiée.
          MAGNISA appliquera automatiquement la règle correspondant à la catégorie et à la période du bulletin.
        </p>
        {overtime.length === 0 && <p className="notice">Aucun taux personnalisé n'est enregistré. Sans règle officielle unique et datée, MAGNISA refusera le calcul des heures supplémentaires de cette catégorie.</p>}
        {overtime.map((rule, index) => (
          <div className="card section" key={index}>
            <div className="actions" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <strong>Majoration {index + 1}</strong>
              <button type="button" className="button" onClick={() => setOvertime((current) => current.filter((_, i) => i !== index))}>Supprimer cette majoration</button>
            </div>
            <div className="grid2">
              <Field label="Catégorie">
                <select value={rule.category || "regular"} onChange={(e) => updateOvertime(index, { category: e.target.value as OvertimeCategory })}>
                  {overtimeCategories.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </Field>
              <Field label="Majoration (%)">
                <input type="number" min="0" max="500" step="0.01" value={rule.premiumPercent ?? ""}
                  onChange={(e) => updateOvertime(index, { premiumPercent: e.target.value === "" ? "" : Number(e.target.value) })} required />
              </Field>
              <Field label="Référence officielle (texte, article, URL)">
                <input value={rule.legalReference || ""} onChange={(e) => updateOvertime(index, { legalReference: e.target.value })} required />
              </Field>
              <Field label="Version de la règle">
                <input value={rule.ruleVersion || ""} onChange={(e) => updateOvertime(index, { ruleVersion: e.target.value })} placeholder="Ex. Code du travail-v1" required />
              </Field>
              <Field label="Date d'effet">
                <input type="date" value={rule.effectiveFrom || ""} onChange={(e) => updateOvertime(index, { effectiveFrom: e.target.value })} required />
              </Field>
              <Field label="Date de fin (facultative)">
                <input type="date" value={rule.effectiveTo || ""} onChange={(e) => updateOvertime(index, { effectiveTo: e.target.value || undefined })} />
              </Field>
            </div>
          </div>
        ))}
        <button type="button" className="button" onClick={() => setOvertime((current) => [...current, {
          category: "regular", premiumPercent: "", legalReference: "", ruleVersion: "", effectiveFrom: "",
        }])}>Ajouter une catégorie de majoration</button>
      </section>
    </div>
  );
}
