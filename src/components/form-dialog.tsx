"use client";

import { Children, cloneElement, createContext, Fragment, isValidElement, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { ModalFrame } from "@/components/modal-frame";
import { executeFormDialogAction, type FormDialogServerAction } from "@/lib/form-dialog-action";

type ServerAction = FormDialogServerAction;
type ActionElementProps = { action?: string | ServerAction; children?: ReactNode };
type FormControlSnapshot = {
  index: number;
  value: string;
  checked?: boolean;
  selected?: string[];
};

type FormDialogContextValue = { wrapAction: (action: ServerAction, propagateErrors?: boolean) => ServerAction };
const FormDialogContext = createContext<FormDialogContextValue | null>(null);

/** Connect a nested client form to the surrounding FormDialog lifecycle. */
export function useFormDialogAction(action: ServerAction): ServerAction {
  const context = useContext(FormDialogContext);
  return useMemo(() => context?.wrapAction(action, true) ?? action, [context, action]);
}

function replaceServerActions(node: ReactNode, wrapAction: (action: ServerAction, propagateErrors?: boolean) => ServerAction): { children: ReactNode[]; found: boolean } {
  const nodes = Children.toArray(node);
  let found = false;
  const children = nodes.map((child) => {
    if (!isValidElement<ActionElementProps>(child)) return child;
    if (typeof child.props.action === "function") {
      found = true;
      return cloneElement(child, { action: wrapAction(child.props.action) });
    }
    const nested = replaceServerActions(child.props.children, wrapAction);
    if (nested.found) {
      found = true;
      return cloneElement(child, undefined, ...nested.children);
    }
    return child;
  });
  return { children, found };
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
  // Do not expose a validation error before React has restored uncontrolled inputs.
  const [errorReady, setErrorReady] = useState(false);
  const [success, setSuccess] = useState(false);
  const pendingRef = useRef(false);
  const formSnapshotRef = useRef<FormControlSnapshot[] | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    if (isBusy || pendingRef.current) return;
    setOpen(false);
    requestAnimationFrame(() => openerRef.current?.focus());
  }, [isBusy]);

  const wrapAction = useCallback((action: ServerAction, propagateErrors = false): ServerAction => async (formData) => {
    setErrorReady(false);
    await executeFormDialogAction(action, formData, pendingRef, {
      setPending,
      setError,
      onSuccess: () => { setSuccess(true); setOpen(false); },
    }, propagateErrors);
  }, []);
  const dialogContextValue = useMemo(() => ({ wrapAction }), [wrapAction]);
  const wrappedChildren = replaceServerActions(children, wrapAction);
  const content = <>
    {wrappedChildren.found ? (
      <fieldset disabled={pending} onSubmitCapture={(event) => {
        const target = event.target;
        if (!(target instanceof HTMLFormElement)) return;
        formSnapshotRef.current = Array.from(target.elements).flatMap((element, index): FormControlSnapshot[] => {
          if (element instanceof HTMLInputElement) {
            return element.type === "file" ? [] : [{ index, value: element.value, checked: element.checked }];
          }
          if (element instanceof HTMLTextAreaElement) return [{ index, value: element.value }];
          if (element instanceof HTMLSelectElement) {
            return [{ index, value: element.value, selected: Array.from(element.selectedOptions).map((option) => option.value) }];
          }
          return [];
        });
      }} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        {wrappedChildren.children}
      </fieldset>
    ) : children}
    {pending ? <p className="muted" role="status" aria-live="polite">Traitement en cours…</p> : null}
    {error && errorReady ? <div className="error" role="alert" aria-live="assertive">{error}</div> : null}
  </>;

  useEffect(() => {
    if (!error) return;
    if (!formSnapshotRef.current) {
      setErrorReady(true);
      return;
    }
    // React resets uncontrolled form controls when an action promise resolves.
    // Defer restoration past that reset (a timer plus two paint frames) so a
    // handled server-side validation error never erases the user's entries.
    let firstFrame = 0;
    let secondFrame = 0;
    const timer = window.setTimeout(() => {
      firstFrame = requestAnimationFrame(() => {
        secondFrame = requestAnimationFrame(() => {
          const form = contentRef.current?.querySelector("form");
          if (!form) {
            setErrorReady(true);
            return;
          }
          formSnapshotRef.current?.forEach(({ index, value, checked, selected }) => {
            const element = form.elements.item(index);
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
          // Notify users only after inputs are restored and stable.
          setErrorReady(true);
        });
      });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      if (firstFrame) cancelAnimationFrame(firstFrame);
      if (secondFrame) cancelAnimationFrame(secondFrame);
    };
  }, [error]);

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
      {open ? <ModalFrame title={title} onClose={close} isBusy={isBusy || pending}><FormDialogContext.Provider value={dialogContextValue}><div ref={contentRef}>{content}</div></FormDialogContext.Provider></ModalFrame> : null}
    </>
  );
}
