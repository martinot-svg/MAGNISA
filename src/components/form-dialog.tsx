"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { ModalFrame } from "@/components/modal-frame";

export function FormDialog({
  children,
  title,
  buttonLabel,
  buttonClassName = "button primary",
}: {
  children: ReactNode;
  title: string;
  buttonLabel: string;
  buttonClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const openerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => openerRef.current?.focus());
  }, []);

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
      {open ? <ModalFrame title={title} onClose={close}>{children}</ModalFrame> : null}
    </>
  );
}
