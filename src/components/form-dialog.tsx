"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { ModalFrame } from "@/components/modal-frame";

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
  const openerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    if (isBusy) return;
    setOpen(false);
    requestAnimationFrame(() => openerRef.current?.focus());
  }, [isBusy]);

  return (
    <>
      <button
        ref={openerRef}
        type="button"
        className={buttonClassName}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        {buttonLabel}
      </button>
      {open ? (
        <ModalFrame title={title} onClose={close} isBusy={isBusy}>
          {children}
        </ModalFrame>
      ) : null}
    </>
  );
}
