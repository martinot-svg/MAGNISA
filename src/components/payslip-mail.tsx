"use client";

import { useId, useRef, useState } from "react";
import { ModalFrame } from "@/components/modal-frame";

export function PayslipMail({ id, email, number }: { id: string; email: string; number: string }) {
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState(
    "Bonjour,\n\nVeuillez trouver en pièce jointe votre bulletin de paie.\n\nCordialement.",
  );
  const [subject, setSubject] = useState("Bulletin de paie " + number);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const sendingRef = useRef(false);
  const fieldsId = useId();

  const close = () => {
    if (sendingRef.current) return;
    setOpen(false);
    setFeedback(null);
  };

  async function send() {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/payroll/payslips/" + encodeURIComponent(id) + "/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: email, subject: subject.trim(), body: message.trim() }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Envoi impossible");
      setFeedback({
        type: "success",
        text: "Envoi confirmé par Gmail. Le bulletin PDF a été joint au message.",
      });
    } catch (error) {
      setFeedback({
        type: "error",
        text: error instanceof Error ? error.message : "Erreur d'envoi",
      });
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  return (
    <>
      <button type="button" className="button primary" onClick={() => setOpen(true)} disabled={!email}>
        Envoyer par e-mail
      </button>
      {open && (
        <ModalFrame title="Envoi confidentiel" onClose={close} isBusy={sending} width="min(580px, 100%)">
          <p>Destinataire : <strong>{email}</strong> (adresse du salarié non modifiable)</p>
          <form
            className="form"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <div className="field">
              <label htmlFor={`${fieldsId}-subject`}>Objet</label>
              <input
                id={`${fieldsId}-subject`}
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                maxLength={180}
                disabled={sending}
                required
              />
            </div>
            <div className="field">
              <label htmlFor={`${fieldsId}-message`}>Message</label>
              <textarea
                id={`${fieldsId}-message`}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                rows={5}
                disabled={sending}
                required
              />
            </div>
            <p className="muted">Pièce jointe : {number}.pdf. Transmission uniquement après validation du bulletin.</p>
            {feedback && (
              <div
                role={feedback.type === "error" ? "alert" : "status"}
                aria-live={feedback.type === "error" ? "assertive" : "polite"}
                className={feedback.type === "success" ? "success" : "error"}
              >
                {feedback.text}
              </div>
            )}
            <div className="actions">
              <button type="button" className="button" onClick={close} disabled={sending}>Fermer</button>
              <button type="submit" className="button primary" disabled={sending || !subject.trim() || !message.trim()}>
                {sending ? "Envoi en cours..." : "Confirmer l'envoi"}
              </button>
            </div>
          </form>
        </ModalFrame>
      )}
    </>
  );
}
