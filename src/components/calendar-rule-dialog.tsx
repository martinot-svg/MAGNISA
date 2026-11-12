"use client";

import { useState, type ReactNode } from "react";
import { ModalFrame } from "@/components/modal-frame";

export function CalendarRuleDialog({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="button primary"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        + Ajouter une nouvelle règle
      </button>
      {open ? (
        <ModalFrame title={title} onClose={() => setOpen(false)} width="min(760px, 100%)">
          {children}
        </ModalFrame>
      ) : null}
    </>
  );
}
