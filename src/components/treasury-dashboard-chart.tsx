"use client";

import { useState } from "react";

type Props = {
  active: number;
  total: number;
  inflows: number;
  outflows: number;
  currency: string;
};

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "MGA" ? 0 : 2,
  }).format(amount);
}

export function TreasuryDashboardChart({ active, total, inflows, outflows, currency }: Props) {
  const [mode, setMode] = useState<"bar" | "donut" | "kpi">("bar");
  const inactive = Math.max(0, total - active);
  const ratio = total > 0 ? Math.max(0, Math.min(100, (active / total) * 100)) : 0;
  const maxFlow = Math.max(1, inflows, outflows);
  const flowValues = [
    { name: "Entrées récentes", value: inflows },
    { name: "Sorties récentes", value: outflows },
  ];

  return (
    <section className="card" aria-label="Indicateurs de trésorerie">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
        <h3 style={{ margin: 0 }}>Indicateurs de trésorerie</h3>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="treasury-chart-choice">Type de graphique</label>
          <select id="treasury-chart-choice" value={mode} onChange={e => setMode(e.target.value as "bar" | "donut" | "kpi")}>
            <option value="bar">Entrées / sorties</option>
            <option value="donut">Comptes actifs</option>
            <option value="kpi">Indicateurs KPI</option>
          </select>
        </div>
      </div>

      {mode === "kpi" ? (
        <div className="grid2" aria-label="Indicateurs KPI de trésorerie">
          <div className="card" style={{ padding: 16 }}>
            <div className="muted">Comptes actifs</div>
            <div className="metric">{active} / {total}</div>
          </div>
          {flowValues.map(item => (
            <div className="card" style={{ padding: 16 }} key={item.name}>
              <div className="muted">{item.name}</div>
              <div className="metric">{formatMoney(item.value, currency)}</div>
            </div>
          ))}
        </div>
      ) : mode === "bar" ? (
        <div role="img" aria-label={flowValues.map(item => item.name + ": " + formatMoney(item.value, currency)).join(", ")} style={{ display: "grid", gap: 16 }}>
          {flowValues.map(item => (
            <div key={item.name} style={{ display: "grid", gridTemplateColumns: "minmax(110px,1fr) minmax(90px,2fr)", alignItems: "center", gap: 12 }}>
              <span>{item.name}</span>
              <div>
                <div style={{ height: 22, background: "var(--surface-2, #e5e7eb)", borderRadius: 6, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: (item.value / maxFlow * 100) + "%", background: "var(--primary, #2563eb)", borderRadius: 6 }} />
                </div>
                <strong>{formatMoney(item.value, currency)}</strong>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ display: "flex", gap: 22, flexWrap: "wrap", alignItems: "center" }}>
          <div role="img" aria-label={total === 0 ? "Aucun compte" : active + " comptes actifs et " + inactive + " inactifs sur " + total} style={{ width: 170, height: 170, borderRadius: "50%", background: total === 0 ? "#e5e7eb" : "conic-gradient(#2563eb 0% " + ratio + "%, #cbd5e1 " + ratio + "% 100%)", display: "grid", placeItems: "center", flexShrink: 0 }}>
            <div style={{ width: 115, height: 115, borderRadius: "50%", background: "var(--background, white)", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", color: "var(--foreground, #111827)" }}>
              <strong style={{ fontSize: 25 }}>{total === 0 ? "-" : Math.round(ratio) + "%"}</strong>
              <small>actifs</small>
            </div>
          </div>
          <div><p><strong>{active}</strong> comptes actifs</p><p><strong>{inactive}</strong> comptes inactifs</p><p><strong>{total}</strong> comptes au total</p><p className="muted">L'anneau représente la répartition des comptes uniquement.</p></div>
        </div>
      )}
      <p className="muted" style={{ marginTop: 14 }}>Les montants couvrent les 100 derniers mouvements chargés, pas tout l'historique. Les transferts internes peuvent apparaître comme une sortie et une entrée distinctes.</p>
    </section>
  );
}
