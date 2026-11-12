"use client";

import { useId, useRef, useState } from "react";
import { ModalFrame } from "@/components/modal-frame";

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
  const sendingRef = useRef(false);
  const fieldsId = useId();

  const close = () => {
    if (sendingRef.current) return;
    setOpen(false);
    setFeedback(null);
  };

  const sendEmail = async () => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setFeedback(null);
    setSending(true);
    try {
      const response = await fetch(
        `/api/documents/${documentType}/${encodeURIComponent(documentId)}/email`,
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
      sendingRef.current = false;
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
        <ModalFrame title="Envoyer par Gmail" onClose={close} isBusy={sending} width="min(680px, 100%)">
          <p className="eyebrow" style={{ marginBottom: 6 }}>Messagerie MAGNISA</p>
          <p className="muted" style={{ marginTop: 0 }}>
            Le PDF du document sera joint automatiquement.
          </p>

          <form
            className="form"
            onSubmit={(event) => {
              event.preventDefault();
              void sendEmail();
            }}
          >
            <div className="field">
              <label htmlFor={`${fieldsId}-to`}>À</label>
              <input
                id={`${fieldsId}-to`}
                type="email"
                value={to}
                onChange={(event) => setTo(event.target.value)}
                placeholder="client@exemple.com"
                disabled={sending}
                required
              />
            </div>

            <div className="field">
              <label htmlFor={`${fieldsId}-subject`}>Objet</label>
              <input
                id={`${fieldsId}-subject`}
                value={mailSubject}
                onChange={(event) => setMailSubject(event.target.value)}
                disabled={sending}
                maxLength={180}
                required
              />
            </div>

            <div className="field">
              <label htmlFor={`${fieldsId}-message`}>Message</label>
              <textarea
                id={`${fieldsId}-message`}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                rows={9}
                disabled={sending}
                required
              />
            </div>

            <div style={{ padding: 14, borderRadius: 12, background: "#f8fafc", border: "1px solid #e5e7eb" }}>
              <strong>Pièce jointe</strong>
              <div className="muted" style={{ marginTop: 4 }}>PDF généré automatiquement par MAGNISA</div>
            </div>

            {feedback && (
              <div
                role={feedback.type === "error" ? "alert" : "status"}
                aria-live={feedback.type === "error" ? "assertive" : "polite"}
                className={feedback.type === "success" ? "success" : "error"}
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
                type="submit"
                disabled={sending || !to.trim() || !mailSubject.trim() || !message.trim()}
              >
                {sending ? "Envoi en cours..." : "Envoyer"}
              </button>
            </div>
          </form>
        </ModalFrame>
      )}
    </>
  );
}
