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
    setBrackets((current) => {
      const next = [...current];
      // The previous unlimited final bracket becomes a capped bracket before the new final bracket is added.
      if (next[next.length - 1]?.up_to === null) {
        next[next.length - 1] = { ...next[next.length - 1], up_to: 1 };
      }
      return [...next, { up_to: null, rate: 0 }];
    });
  }

  function removeBracket(index: number) {
    if (brackets.length <= 1) return;
    setBrackets((current) => current.filter((_, i) => i !== index));
  }

  return (
    <div className="section">
      <input type="hidden" name={`${namePrefix}_bracket_count`} value={brackets.length} />
      <div className="grid2" style={{ fontWeight: 600, marginBottom: 8 }}>
        <div>Tranche de revenu mensuel imposable (Ar)</div>
        <div>Taux</div>
      </div>
      <p className="muted">La borne minimale est calculée automatiquement à partir de la tranche précédente pour éviter les chevauchements et les intervalles manquants. La dernière tranche est sans plafond. Les valeurs sont enregistrées comme brouillon à vérifier.</p>
      {brackets.map((bracket, index) => {
        const isLast = index === brackets.length - 1;
        const previousCap = index === 0 ? null : brackets[index - 1].up_to;
        const lowerBound = index === 0 ? 0 : previousCap === null ? "" : previousCap + 1;
        return (
          <div className="grid2" key={index} style={{ alignItems: "end", marginBottom: 10 }}>
            <div className="field">
              <label htmlFor={`${namePrefix}_cap_${index}`}>Tranche {index + 1}</label>
              <div className="actions" style={{ alignItems: "center", flexWrap: "nowrap" }}>
                <input
                  aria-label={`Borne minimale de la tranche ${index + 1} en ariary`}
                  type="number"
                  value={lowerBound}
                  readOnly
                  style={{ minWidth: 0 }}
                />
                <span>à</span>
                <input
                  id={`${namePrefix}_cap_${index}`}
                  name={`${namePrefix}_cap_${index}`}
                  type="number"
                  min={typeof lowerBound === "number" ? lowerBound + 1 : 1}
                  step="1"
                  value={isLast ? "" : bracket.up_to ?? ""}
                  placeholder={isLast ? "Sans plafond" : "Borne maximale"}
                  disabled={isLast}
                  required={!isLast}
                  style={{ minWidth: 0 }}
                  onChange={(event) => update(index, { up_to: event.target.value === "" ? null : Number(event.target.value) })}
                />
                {brackets.length > 1 ? <button type="button" className="button" onClick={() => removeBracket(index)} aria-label={`Supprimer la tranche ${index + 1}`}>Supprimer</button> : null}
              </div>
            </div>
            <div className="field">
              <label htmlFor={`${namePrefix}_rate_${index}`}>Taux applicable (%)</label>
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
            </div>
          </div>
        );
      })}
      <button type="button" className="button" onClick={addBracket} disabled={brackets.length >= 20}>Ajouter une tranche</button>
      {brackets.length >= 20 ? <p className="muted">Maximum de 20 tranches.</p> : null}
    </div>
  );
}
