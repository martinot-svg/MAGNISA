"use client";

import { useState } from "react";

type Props = {
  defaultServiceType?: "one_off" | "recurring";
  defaultFrequency?: string;
  defaultCustomIntervalDays?: number | null;
};

const frequencies = [
  { value: "daily", label: "Quotidienne" },
  { value: "weekly", label: "Hebdomadaire" },
  { value: "monthly", label: "Mensuelle" },
  { value: "quarterly", label: "Trimestrielle" },
  { value: "semiannual", label: "Semestrielle" },
  { value: "annual", label: "Annuelle" },
  { value: "custom", label: "Personnalisée" },
];

export function ServiceRecurrenceFields({
  defaultServiceType = "one_off",
  defaultFrequency = "monthly",
  defaultCustomIntervalDays = 30,
}: Props) {
  const [serviceType, setServiceType] = useState<"one_off" | "recurring">(defaultServiceType);
  const [frequency, setFrequency] = useState(defaultFrequency || "monthly");

  return (
    <>
      <div className="field">
        <label>Type de prestation</label>
        <select name="service_type" value={serviceType} onChange={(event) => setServiceType(event.target.value as "one_off" | "recurring")} required>
          <option value="one_off">Ponctuelle</option>
          <option value="recurring">Récurrente</option>
        </select>
        <small>Le type définit le mode habituel de vente de cette prestation.</small>
      </div>
      {serviceType === "recurring" && (
        <>
          <div className="field">
            <label>Fréquence</label>
            <select name="recurrence_frequency" value={frequency} onChange={(event) => setFrequency(event.target.value)} required>
              {frequencies.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}
            </select>
          </div>
          {frequency === "custom" && (
            <div className="field">
              <label>Intervalle personnalisé (jours)</label>
              <input name="custom_interval_days" type="number" min="1" max="365" step="1" defaultValue={defaultCustomIntervalDays || 30} required />
              <small>Indique le nombre de jours entre deux échéances, de 1 à 365 jours.</small>
            </div>
          )}
        </>
      )}
    </>
  );
}
