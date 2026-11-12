"use client";

import { Children, cloneElement, Fragment, isValidElement, useCallback, useRef, useState, type ReactElement, type ReactNode } from "react";
import { ModalFrame } from "@/components/modal-frame";

type ServerAction = (formData: FormData) => unknown | Promise<unknown>;
type ActionElementProps = { action?: string | ServerAction; children?: ReactNode };
type FormControl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
type FormControlSnapshot = {
  element: FormControl;
  value: string;
  checked?: boolean;
  selected?: string[];
};

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
  const formSnapshotRef = useRef<FormControlSnapshot[] | null>(null);
  const openerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    if (isBusy || pendingRef.current) return;
    setOpen(false);
    requestAnimationFrame(() => openerRef.current?.focus());
  }, [isBusy]);

  const childNodes = Children.toArray(children);
  const actionIndex = childNodes.findIndex(
    (child) => isValidElement<ActionElementProps>(child) && typeof child.props.action === "function",
  );
  const actionElement = actionIndex >= 0
    ? childNodes[actionIndex] as ReactElement<ActionElementProps>
    : null;
  const originalAction = actionElement?.props.action;

  const wrappedAction: ServerAction | undefined = actionElement && typeof originalAction === "function"
    ? async (formData: FormData) => {
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
          const snapshot = formSnapshotRef.current;
          requestAnimationFrame(() => {
            snapshot?.forEach(({ element, value, checked, selected }) => {
              if (!element.isConnected) return;
              if (element instanceof HTMLInputElement) {
                if (element.type === "checkbox" || element.type === "radio") element.checked = !!checked;
                else if (element.type !== "file") element.value = value;
              } else if (element instanceof HTMLTextAreaElement) {
                element.value = value;
              } else if (element instanceof HTMLSelectElement) {
                if (element.multiple && selected) {
                  Array.from(element.options).forEach((option) => { option.selected = selected.includes(option.value); });
                } else {
                  element.value = value;
                }
              }
            });
          });
        } finally {
          pendingRef.current = false;
          setPending(false);
        }
      }
    : undefined;

  const content = actionElement && wrappedAction
    ? <>
        {childNodes.map((child, index) => index === actionIndex
          ? <fieldset key={index} disabled={pending} onSubmitCapture={(event) => {
              const target = event.target;
              if (!(target instanceof HTMLFormElement)) return;
              formSnapshotRef.current = Array.from(target.elements).flatMap((element): FormControlSnapshot[] => {
                if (element instanceof HTMLInputElement) {
                  return element.type === "file" ? [] : [{ element, value: element.value, checked: element.checked }];
                }
                if (element instanceof HTMLTextAreaElement) return [{ element, value: element.value }];
                if (element instanceof HTMLSelectElement) {
                  return [{ element, value: element.value, selected: Array.from(element.selectedOptions).map((option) => option.value) }];
                }
                return [];
              });
            }} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: "contents" }}>
              {cloneElement(actionElement, { action: wrappedAction })}
            </fieldset>
          : <Fragment key={index}>{child}</Fragment>)}
        {pending ? <p className="muted" role="status" aria-live="polite">Traitement en cours…</p> : null}
        {error ? <div className="error" role="alert" aria-live="assertive">{error}</div> : null}
      </>
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
