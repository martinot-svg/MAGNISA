"use client";
import { useEffect, useState } from "react";
import { FinancialAccountCreationFields } from "@/components/financial-account-creation-fields";

export function TreasuryAccountDialog({ createAccount }: { createAccount: (data: FormData) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);
  return <>
    <button type="button" className="button primary" onClick={() => setOpen(true)}>+ Nouveau compte</button>
    {open && <div role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }} style={{position:"fixed",inset:0,zIndex:1000,background:"rgba(10,18,32,.65)",display:"flex",justifyContent:"center",alignItems:"center",padding:16}}>
      <section role="dialog" aria-modal="true" aria-labelledby="new-treasury-account-title" className="card" style={{width:"min(100%,600px)",maxHeight:"min(90vh,900px)",overflowY:"auto",padding:24}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,marginBottom:12}}>
          <h2 id="new-treasury-account-title" style={{margin:0}}>Nouveau compte</h2>
          <button className="button" type="button" aria-label="Fermer" onClick={() => setOpen(false)}>✕</button>
        </div>
        <p className="muted">Le solde n'est jamais saisi manuellement : il évolue uniquement par les opérations enregistrées.</p>
        <form action={createAccount} className="form">
          <FinancialAccountCreationFields />
        </form>
      </section>
    </div>}
  </>;
}
