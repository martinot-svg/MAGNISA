"use client";

import { useCallback, useRef, useState } from "react";
import { FinancialAccountCreationFields } from "@/components/financial-account-creation-fields";
import { ModalFrame } from "@/components/modal-frame";

export function TreasuryAccountDialog({
  createAccount,
}: {
  createAccount: (data: FormData) => Promise<void>;
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
        className="button primary"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        + Nouveau compte
      </button>
      {open ? (
        <ModalFrame title="Nouveau compte" onClose={close} width="min(600px, 100%)">
          <p className="muted">
            Le solde n'est jamais saisi manuellement : il évolue uniquement par les opérations enregistrées.
          </p>
          <form action={createAccount} className="form">
            <FinancialAccountCreationFields />
          </form>
        </ModalFrame>
      ) : null}
    </>
  );
}
