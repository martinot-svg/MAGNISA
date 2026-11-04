"use client";

import { useEffect, useState, type ReactNode } from "react";

export function CalendarRuleDialog({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  return (
    <>
      <button type="button" className="button primary" onClick={() => setOpen(true)}>
        + Ajouter une nouvelle règle
      </button>
      {open ? (
        <div
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            background: "rgba(10, 18, 32, .48)",
            backdropFilter: "blur(2px)",
            WebkitBackdropFilter: "blur(2px)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            padding: 16,
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="calendar-rule-dialog-title"
            className="card"
            style={{
              width: "min(100%, 760px)",
              maxHeight: "min(92vh, 960px)",
              overflowY: "auto",
              padding: 24,
              boxShadow: "0 28px 90px rgba(10, 18, 32, .28)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                marginBottom: 12,
              }}
            >
              <h2 id="calendar-rule-dialog-title" style={{ margin: 0 }}>
                {title}
              </h2>
              <button
                className="button"
                type="button"
                aria-label="Fermer le formulaire"
                onClick={() => setOpen(false)}
              >
                ✕
              </button>
            </div>
            {children}
          </section>
        </div>
      ) : null}
    </>
  );
}
