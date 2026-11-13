"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Configuration des seuils de préavis. Le bouton enregistre uniquement
 * les règles de programmation : aucun e-mail n'est expédié ici.
 */
export function MGMailPreavisPolicyForm({
  initialOffsets,
  initialEnabled,
}: {
  initialOffsets: number[];
  initialEnabled: boolean;
}) {
  const router = useRouter();
  const [offsets, setOffsets] = useState(initialOffsets.join(", "));
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [failed, setFailed] = useState(false);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setFeedback("");
    setFailed(false);
    try {
      const response = await fetch("/api/magnimail/preavis-policy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offsets, enabled }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result?.error || "Impossible d'enregistrer la configuration.");
      }
      setFeedback("Délais enregistrés. Aucun e-mail n'a été envoyé.");
      router.refresh();
    } catch (error) {
      setFailed(true);
      setFeedback(error instanceof Error ? error.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card section">
      <h2>Paramètres des préavis</h2>
      <p className="muted">
        Choisissez librement vos délais (en jours avant la facturation) :
        15, 10, 5, 1 ou, par exemple, 30, 12, 7, 2.
      </p>
      <form onSubmit={save} className="form">
        <div className="field">
          <label htmlFor="mgmail-preavis-offsets">Délais avant facturation (jours, séparés par des virgules)</label>
          <input
            id="mgmail-preavis-offsets"
            value={offsets}
            onChange={(event) => setOffsets(event.target.value)}
            disabled={saving}
            maxLength={500}
            placeholder="15, 10, 5, 1"
            required
          />
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={enabled}
            disabled={saving}
            onChange={(event) => setEnabled(event.target.checked)}
            style={{ width: "auto" }}
          />
          Activer cette politique de préavis
        </label>
        <div className="actions">
          <button className="button primary" type="submit" disabled={saving || !offsets.trim()}>
            {saving ? "Enregistrement…" : "Enregistrer les délais"}
          </button>
        </div>
        {feedback && (
          <p role={failed ? "alert" : "status"} className={failed ? "muted" : "success compact"}>
            {feedback}
          </p>
        )}
      </form>
    </div>
  );
}
