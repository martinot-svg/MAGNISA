"use client";

import { useState, type ReactNode } from "react";

type Section = "simulator" | "create" | "history";

export function PayrollSettingsDisclosure({
  simulator,
  createRule,
  history,
}: {
  simulator: ReactNode;
  createRule: ReactNode;
  history: ReactNode;
}) {
  const [active, setActive] = useState<Section | null>(null);
  const items: { id: Section; label: string }[] = [
    { id: "simulator", label: "Simulateur de paie" },
    { id: "create", label: "Créer un référentiel réglementaire" },
    { id: "history", label: "Historique des règles" },
  ];
  const content = active === "simulator" ? simulator : active === "create" ? createRule : history;

  return (
    <section aria-label="Outils des paramètres de paie" style={{ width: "100%" }}>
      <div className="actions" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: 12, width: "100%" }}>
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={active === item.id ? "button primary" : "button"}
            aria-pressed={active === item.id}
            onClick={() => setActive((current) => current === item.id ? null : item.id)}
            style={{ minHeight: 46, width: "100%", whiteSpace: "normal", justifyContent: "center" }}
          >
            {item.label}
          </button>
        ))}
      </div>
      {active && (
        <div style={{ marginTop: 18 }}>
          <div className="actions" style={{ justifyContent: "flex-end", marginBottom: 10 }}>
            <button type="button" className="button" onClick={() => setActive(null)}>Retour aux paramètres</button>
          </div>
          {content}
        </div>
      )}
    </section>
  );
}
