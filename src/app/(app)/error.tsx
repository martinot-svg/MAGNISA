"use client";

import { useEffect } from "react";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("MAGNISA application boundary caught an error", {
      digest: error.digest,
      message: error.message,
    });
  }, [error]);

  return (
    <main className="page">
      <section className="card" role="alert" aria-live="assertive">
        <h1>Une opération n’a pas pu aboutir</h1>
        <p>
          MAGNISA a rencontré une erreur inattendue. Aucune confirmation de
          réussite ne doit être supposée. Vérifie la liste des paiements avant
          de réessayer afin d’éviter un doublon.
        </p>
        {error.digest && (
          <p>
            <strong>Référence de diagnostic :</strong>{" "}
            <code>{error.digest}</code>
          </p>
        )}
        <div className="actions">
          <button className="button primary" type="button" onClick={reset}>
            Réessayer
          </button>
          <a className="button" href="/paiements">
            Revenir aux paiements
          </a>
        </div>
        <p className="muted">
          Si l’erreur revient, transmets cette référence au support. Les détails
          techniques restent dans les journaux serveur.
        </p>
      </section>
    </main>
  );
}
