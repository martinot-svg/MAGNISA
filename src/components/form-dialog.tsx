"use client";

import { cloneElement, isValidElement, useCallback, useRef, useState, type ReactElement, type ReactNode } from "react";
import { ModalFrame } from "@/components/modal-frame";

type ServerAction = (formData: FormData) => unknown | Promise<unknown>;
type FormProps = { action?: string | ServerAction; children?: ReactNode };

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/NEXT_REDIRECT/i.test(message)) throw error;
  if (/permission denied|row.level security|not authorized|unauthorized/i.test(message)) {
    return "Tu n'as pas les autorisations nécessaires pour effectuer cette opération.";
  }
  if (/duplicate key|unique constraint/i.test(message)) {
    return "Un enregistrement avec ces informations existe déjà.";
  }
  if (/failed to fetch|networkerror|fetch failed/i.test(message)) {
    return "Le serveur n'a pas répondu. Vérifie la connexion puis réessaie.";
  }
  return message && message.length <= 240
    ? message
    : "L'opération n'a pas abouti. Vérifie les informations puis réessaie.";
}

export function FormDialog({
  children,
  title,
  buttonLabel,
  buttonClassName = "button primary",
  isBusy = false,
}: {
  children: ReactNode;
  title: string;
  buttonLabel: string;
  buttonClassName?: string;
  isBusy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const pendingRef = useRef(false);
  const openerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    if (isBusy || pendingRef.current) return;
    setOpen(false);
    requestAnimationFrame(() => openerRef.current?.focus());
  }, [isBusy]);

  const form = isValidElement<FormProps>(children) && children.type === "form"
    ? children as ReactElement<FormProps>
    : null;
  const originalAction = form?.props.action;
  const content = form && typeof originalAction === "function"
    ? cloneElement(form, {
        action: async (formData: FormData) => {
          if (pendingRef.current) return;
          pendingRef.current = true;
          setPending(true);
          setError(null);
          try {
            const result = await originalAction(formData);
            if (result && typeof result === "object" && "error" in result && result.error) {
              throw new Error(String(result.error));
            }
            setSuccess(true);
            setOpen(false);
          } catch (actionError) {
            setError(errorMessage(actionError));
          } finally {
            pendingRef.current = false;
            setPending(false);
          }
        },
      },
      <>
        <fieldset disabled={pending} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: "contents" }}>
          {form.props.children}
        </fieldset>
        {pending ? <p className="muted" role="status" aria-live="polite">Traitement en cours…</p> : null}
        {error ? <div className="error" role="alert" aria-live="assertive">{error}</div> : null}
      </>,
    )
    : children;

  return (
    <>
      <button
        ref={openerRef}
        type="button"
        className={buttonClassName}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setError(null);
          setSuccess(false);
          setOpen(true);
        }}
      >
        {buttonLabel}
      </button>
      {success && !open ? <p className="success" role="status">Opération enregistrée.</p> : null}
      {open ? <ModalFrame title={title} onClose={close} isBusy={isBusy || pending}>{content}</ModalFrame> : null}
    </>
  );
}
