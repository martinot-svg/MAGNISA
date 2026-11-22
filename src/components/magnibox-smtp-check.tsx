"use client";

import { useState } from "react";

export function MagniboxSmtpCheck() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function checkConnection() {
    setLoading(true);
    setResult(null);
    try {
      const response = await fetch("/api/magnibox/internet/smtp-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
      });
      const payload = await response.json() as { ok?: boolean; message?: string; error?: string };
      setResult({
        ok: response.ok && payload.ok === true,
        message: payload.message || payload.error || "Résultat du contrôle SMTP indisponible.",
      });
    } catch {
      setResult({ ok: false, message: "Impossible de joindre le contrôle SMTP MAGNIBOX." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="actions" style={{ alignItems: "center", gap: 12 }}>
      <button className="button primary" type="button" onClick={checkConnection} disabled={loading}>
        {loading ? "Vérification SMTP…" : "Tester la connexion SMTP"}
      </button>
      {result && (
        <p role="status" aria-live="polite" className="muted">
          {result.ok ? "✓ " : "✕ "}{result.message}
        </p>
      )}
    </div>
  );
}
