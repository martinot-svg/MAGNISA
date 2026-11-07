"use client";

import { useState, type ReactNode } from "react";

export function PayrollSettingsDisclosure({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <button type="button" className="button primary" aria-expanded={open} aria-controls="payroll-settings-details" onClick={() => setOpen((value) => !value)}>
        {open ? "Masquer prévisualisation et historique" : "Prévisualisation et historique"}
      </button>
      {open && (
        <div id="payroll-settings-details" className="card section" style={{ position: "absolute", zIndex: 60, top: "calc(100% + 10px)", right: 0, width: "min(1100px, calc(100vw - 32px))", maxHeight: "80vh", overflowY: "auto", padding: 16, boxShadow: "0 12px 32px rgba(0,0,0,.18)" }}>
          {children}
        </div>
      )}
    </div>
  );
}
