"use client";

import { useState } from "react";

type IrsaBracket = { up_to: number | null; rate: number };

export function IrsaBracketEditor({
  initialBrackets = [],
  namePrefix = "irsa",
}: {
  initialBrackets?: IrsaBracket[];
  namePrefix?: string;
}) {
  const [brackets, setBrackets] = useState<IrsaBracket[]>(
    initialBrackets.length
      ? initialBrackets.map((b) => ({ up_to: b.up_to ?? null, rate: Number(b.rate) * 100 }))
      : [{ up_to: null, rate: 0 }],
  );

  function update(index: number, patch: Partial<IrsaBracket>) {
    setBrackets((current) => current.map((item, i) => i === index ? { ...item, ...patch } : item));
  }

  function addBracket() {
    if (brackets.length >= 20) return;
    setBrackets((current) => [...current, { up_to: null, rate: 0 }]);
  }

  function removeBracket(index: number) {
    if (brackets.length <= 1) return;
    setBrackets((current) => current.filter((_, i) => i !== index));
  }

  return (
    <div className="section">
      <input type="hidden" name={`${namePrefix}_bracket_count`} value={brackets.length} />
      <p className="muted">Configure les plafonds et les taux de chaque tranche. La dernière tranche doit rester sans plafond. Les valeurs sont enregistrées comme brouillon à vérifier.</p>
      {brackets.map((bracket, index) => {
        const isLast = index === brackets.length - 1;
        return (
          <div className="grid2" key={index} style={{ alignItems: "end", marginBottom: 10 }}>
            <div className="field">
              <label htmlFor={`${namePrefix}_cap_${index}`}>Tranche {index + 1} - plafond (Ar)</label>
              <input
                id={`${namePrefix}_cap_${index}`}
                name={`${namePrefix}_cap_${index}`}
                type="number"
                min="1"
                step="1"
                value={isLast ? "" : bracket.up_to ?? ""}
                placeholder={isLast ? "Sans plafond - dernière tranche" : "Plafond de la tranche"}
                disabled={isLast}
                required={!isLast}
                onChange={(event) => update(index, { up_to: event.target.value === "" ? null : Number(event.target.value) })}
              />
            </div>
            <div className="field">
              <label htmlFor={`${namePrefix}_rate_${index}`}>Taux de la tranche (%)</label>
              <div className="actions" style={{ alignItems: "center" }}>
                <input
                  id={`${namePrefix}_rate_${index}`}
                  name={`${namePrefix}_rate_${index}`}
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={bracket.rate}
                  required
                  onChange={(event) => update(index, { rate: event.target.value === "" ? 0 : Number(event.target.value) })}
                />
                {brackets.length > 1 ? <button type="button" className="button" onClick={() => removeBracket(index)} aria-label={`Supprimer la tranche ${index + 1}`}>Supprimer</button> : null}
              </div>
            </div>
          </div>
        );
      })}
      <button type="button" className="button" onClick={addBracket} disabled={brackets.length >= 20}>Ajouter une tranche</button>
      {brackets.length >= 20 ? <p className="muted">Maximum de 20 tranches.</p> : null}
    </div>
  );
}
