"use client";

import { useState } from "react";
import { compensationOptions } from "@/lib/payroll/compensation-options";

export function OtherEarningsTypeField() {
  const [selected, setSelected] = useState("");
  return (
    <>
      <div className="field">
        <label>Type d'autre rémunération</label>
        <select name="other_earnings_code" value={selected} onChange={(e) => setSelected(e.target.value)}>
          <option value="">Sélectionner si des autres gains sont renseignés</option>
          {compensationOptions.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>
      {selected === "other_custom" && (
        <div className="field">
          <label>Précise la rémunération</label>
          <input name="other_earnings_custom_label" maxLength={120} required placeholder="Ex. Indemnité exceptionnelle" />
        </div>
      )}
    </>
  );
}
