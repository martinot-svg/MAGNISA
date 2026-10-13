"use client";

import { useState } from "react";

type Props = {
  pdfUrl: string;
  documentType: "quote" | "invoice";
  documentId: string;
  email?: string | null;
  subject: string;
  body: string;
};

export function DocumentActions({
  pdfUrl,
  documentType,
  documentId,
  email,
  subject,
  body,
}: Props) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(email || "");
  const [mailSubject, setMailSubject] = useState(subject);
  const [message, setMessage] = useState(body);
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const close = () => {
    if (sending) return;
    setOpen(false);
    setFeedback(null);
  };

  const sendEmail = async () => {
    setFeedback(null);
    setSending(true);
    try {
      const response = await fetch(
        `/api/documents/${documentType}/${documentId}/email`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: to.trim(),
            subject: mailSubject.trim(),
            body: message.trim(),
          }),
        },
      );

      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result?.error || "Impossible d'envoyer l'e-mail.");
      }

      setFeedback({
        type: "success",
        text: "E-mail envoyé avec succès depuis MAGNISA. Le PDF a été joint automatiquement.",
      });
    } catch (error) {
      setFeedback({
        type: "error",
        text: error instanceof Error ? error.message : "Impossible d'envoyer l'e-mail.",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <div className="actions">
        <a className="button" href={pdfUrl} target="_blank" rel="noreferrer">
          Aperçu / PDF
        </a>
        {email && (
          <button className="button primary" type="button" onClick={() => setOpen(true)}>
            Préparer l'e-mail
          </button>
        )}
      </div>

      {open && (
        <div
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close();
          }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            background: "rgba(15, 23, 42, .52)",
            display: "grid",
            placeItems: "center",
            padding: 20,
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="magnisa-email-title"
            style={{
              width: "min(680px, 100%)",
              maxHeight: "90vh",
              overflow: "auto",
              background: "#fff",
              borderRadius: 18,
              boxShadow: "0 24px 70px rgba(15,23,42,.24)",
              padding: 24,
            }}
          >
            <div
              style={{
                display: "flex",
                gap: 16,
                alignItems: "flex-start",
                justifyContent: "space-between",
                marginBottom: 18,
              }}
            >
              <div>
                <p className="eyebrow" style={{ marginBottom: 6 }}>Messagerie MAGNISA</p>
                <h2 id="magnisa-email-title" style={{ margin: 0 }}>Envoyer par Gmail</h2>
                <p className="muted" style={{ marginBottom: 0 }}>
                  Le PDF du document sera joint automatiquement.
                </p>
              </div>
              <button className="button" type="button" onClick={close} disabled={sending}>
                Fermer
              </button>
            </div>

            <div className="form">
              <div className="field">
                <label>À</label>
                <input
                  type="email"
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                  placeholder="client@exemple.com"
                  disabled={sending}
                  required
                />
              </div>

              <div className="field">
                <label>Objet</label>
                <input
                  value={mailSubject}
                  onChange={(event) => setMailSubject(event.target.value)}
                  disabled={sending}
                  maxLength={180}
                  required
                />
              </div>

              <div className="field">
                <label>Message</label>
                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  rows={9}
                  disabled={sending}
                  required
                />
              </div>

              <div
                style={{
                  padding: 14,
                  borderRadius: 12,
                  background: "#f8fafc",
                  border: "1px solid #e5e7eb",
                }}
              >
                <strong>Pièce jointe</strong>
                <div className="muted" style={{ marginTop: 4 }}>
                  PDF généré automatiquement par MAGNISA
                </div>
              </div>

              {feedback && (
                <div
                  role="status"
                  style={{
                    padding: 14,
                    borderRadius: 12,
                    background: feedback.type === "success" ? "#f0fdf4" : "#fef2f2",
                    color: feedback.type === "success" ? "#166534" : "#991b1b",
                    border: `1px solid ${feedback.type === "success" ? "#bbf7d0" : "#fecaca"}`,
                  }}
                >
                  {feedback.text}
                </div>
              )}

              <div className="actions" style={{ justifyContent: "flex-end" }}>
                <button className="button" type="button" onClick={close} disabled={sending}>
                  Annuler
                </button>
                <button
                  className="button primary"
                  type="button"
                  onClick={sendEmail}
                  disabled={sending || !to.trim() || !mailSubject.trim() || !message.trim()}
                >
                  {sending ? "Envoi en cours..." : "Envoyer"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
