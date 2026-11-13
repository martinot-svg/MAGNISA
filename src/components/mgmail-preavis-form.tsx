"use client";

import { useState } from "react";
import {
  defaultPreavisRules,
  MAX_PREAVIS_STEPS,
  PREAVIS_TONES,
} from "@/lib/magnimail/preavis-config";
import type { PreavisRule, PreavisTone } from "@/lib/magnimail/preavis";

type Policy = {
  contractId: string | null;
  enabled: boolean;
  rules: PreavisRule[];
};

const toneLabels: Record<PreavisTone, string> = {
  information: "Information",
  courtois: "Rappel courtois",
  important: "Rappel important",
  dernier: "Dernier préavis",
};

export function MGMailPreavisForm({
  policies,
  contracts,
  canManage,
  saveAction,
}: {
  policies: Policy[];
  contracts: Array<{ id: string; description: string }>;
  canManage: boolean;
  saveAction: (formData: FormData) => Promise<void>;
}) {
  const global = policies.find((policy) => policy.contractId === null);
  const [selectedContract, setSelectedContract] = useState("default");
  const [enabled, setEnabled] = useState(global?.enabled ?? true);
  const [rules, setRules] = useState<PreavisRule[]>(
    (global?.rules ?? defaultPreavisRules()).map((rule) => ({ ...rule })),
  );

  function choosePolicy(value: string) {
    setSelectedContract(value);
    const policy = policies.find((item) =>
      value === "default" ? item.contractId === null : item.contractId === value,
    ) ?? global;
    setEnabled(policy?.enabled ?? true);
    setRules((policy?.rules ?? defaultPreavisRules()).map((rule) => ({ ...rule })));
  }

  function changeRule(index: number, patch: Partial<PreavisRule>) {
    setRules((current) =>
      current.map((rule, position) => position === index ? { ...rule, ...patch } : rule),
    );
  }

  const hasOverride =
    selectedContract !== "default" &&
    policies.some((policy) => policy.contractId === selectedContract);

  return (
    <div className="card section">
      <h2>Personnaliser les préavis</h2>
      <p className="muted">
        Choisissez librement les délais avant facturation et le niveau du message.
        Les règles d'entreprise s'appliquent par défaut à tous les contrats,
        sauf si une règle particulière a été enregistrée.
      </p>
      <form action={saveAction} className="form">
        <div className="field">
          <label htmlFor="mgmail-policy-contract">Appliquer les règles à</label>
          <select
            id="mgmail-policy-contract"
            name="contractId"
            value={selectedContract}
            onChange={(event) => choosePolicy(event.target.value)}
          >
            <option value="default">Toute l'entreprise (par défaut)</option>
            {contracts.map((contract) => (
              <option key={contract.id} value={contract.id}>
                {contract.description}
              </option>
            ))}
          </select>
          {selectedContract !== "default" && (
            <small>
              {hasOverride
                ? "Ce contrat possède ses propres réglages."
                : "Aucune exception enregistrée : les règles globales sont actuellement héritées."}
            </small>
          )}
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            disabled={!canManage}
            style={{ width: "auto" }}
          />
          Activer les préavis pour ce périmètre
        </label>
        <input type="hidden" name="enabled" value={enabled ? "true" : "false"} />
        <input type="hidden" name="rules" value={JSON.stringify(rules)} />

        {rules.map((rule, index) => (
          <div
            className="grid2"
            key={rule.id}
            style={{ alignItems: "end", gap: 10, borderBottom: "1px solid #e5e7eb", paddingBottom: 10 }}
          >
            <div className="field">
              <label htmlFor={`mgmail-offset-${index}`}>Jours avant la facture</label>
              <input
                id={`mgmail-offset-${index}`}
                type="number"
                min="1"
                max="3650"
                step="1"
                value={rule.daysBefore}
                disabled={!canManage}
                onChange={(event) =>
                  changeRule(index, { daysBefore: Number(event.target.value) })
                }
                required
              />
            </div>
            <div className="field">
              <label htmlFor={`mgmail-tone-${index}`}>Ton du rappel</label>
              <select
                id={`mgmail-tone-${index}`}
                value={rule.tone}
                disabled={!canManage}
                onChange={(event) =>
                  changeRule(index, { tone: event.target.value as PreavisTone })
                }
              >
                {PREAVIS_TONES.map((tone) => (
                  <option value={tone} key={tone}>{toneLabels[tone]}</option>
                ))}
              </select>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                checked={rule.enabled}
                disabled={!canManage}
                onChange={(event) =>
                  changeRule(index, { enabled: event.target.checked })
                }
                style={{ width: "auto" }}
              />
              Rappel actif
            </label>
            {canManage && (
              <button
                type="button"
                className="button"
                onClick={() => setRules((current) => current.filter((_, i) => i !== index))}
              >
                Supprimer ce délai
              </button>
            )}
          </div>
        ))}

        {canManage && (
          <div className="actions">
            <button
              type="button"
              className="button"
              disabled={rules.length >= MAX_PREAVIS_STEPS}
              onClick={() => setRules((current) => [
                ...current,
                { id: `new-${Date.now()}`, daysBefore: 2, tone: "courtois", enabled: true },
              ])}
            >
              Ajouter un délai
            </button>
            <button className="button primary" type="submit">
              Enregistrer les préavis
            </button>
          </div>
        )}
      </form>
      <p className="muted">
        Les réglages sont enregistrés dans MAGNISA. L'envoi automatique demeure
        désactivé tant que le service MGMail externe et son moteur d'exécution
        n'ont pas été vérifiés.
      </p>
    </div>
  );
}
