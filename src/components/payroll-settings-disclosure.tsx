"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

type Section = "simulator" | "create" | "history";

const items: { id: Section; label: string }[] = [
  { id: "simulator", label: "Simulateur de paie" },
  { id: "create", label: "Créer un référentiel réglementaire" },
  { id: "history", label: "Historique des règles" },
];

export function PayrollSettingsDisclosure({
  simulator,
  createRule,
  history,
}: {
  simulator: ReactNode;
  createRule: ReactNode;
  history: ReactNode;
}) {
  const [active, setActive] = useState<Section | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const activeItem = items.find((item) => item.id === active);
  const content =
    active === "simulator" ? simulator : active === "create" ? createRule : history;

  useEffect(() => {
    if (!active) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setActive(null);
        return;
      }

      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      openerRef.current?.focus();
    };
  }, [active]);

  function closeModal() {
    setActive(null);
  }

  return (
    <section aria-label="Outils des paramètres de paie" style={{ width: "100%" }}>
      <div
        className="actions"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))",
          gap: 12,
          width: "100%",
        }}
      >
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className="button"
            aria-haspopup="dialog"
            aria-expanded={active === item.id}
            onClick={(event) => {
              openerRef.current = event.currentTarget;
              setActive(item.id);
            }}
            style={{
              minHeight: 46,
              width: "100%",
              whiteSpace: "normal",
              justifyContent: "center",
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      {active && activeItem && (
        <div
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeModal();
          }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "clamp(10px, 3vw, 28px)",
            background: "rgba(15, 23, 42, 0.48)",
            backdropFilter: "blur(4px)",
            WebkitBackdropFilter: "blur(4px)",
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="payroll-settings-modal-title"
            tabIndex={-1}
            style={{
              display: "flex",
              flexDirection: "column",
              width: "min(1120px, 100%)",
              maxHeight: "min(92vh, 960px)",
              minHeight: 0,
              overflow: "hidden",
              background: "var(--card, #fff)",
              color: "var(--foreground, #172033)",
              border: "1px solid var(--border, rgba(148, 163, 184, .3))",
              borderRadius: 18,
              boxShadow: "0 24px 80px rgba(0, 0, 0, .28)",
            }}
          >
            <header
              style={{
                position: "sticky",
                top: 0,
                zIndex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 16,
                padding: "16px 20px",
                borderBottom: "1px solid var(--border, #e5e7eb)",
                background: "var(--card, #fff)",
              }}
            >
              <h2
                id="payroll-settings-modal-title"
                style={{ margin: 0, fontSize: 18, lineHeight: 1.35 }}
              >
                {activeItem.label}
              </h2>
              <button
                ref={closeButtonRef}
                type="button"
                className="button"
                onClick={closeModal}
                aria-label="Fermer la fenêtre"
                title="Fermer"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flex: "0 0 40px",
                  width: 40,
                  height: 40,
                  minWidth: 40,
                  padding: 0,
                  borderRadius: 10,
                }}
              >
                <svg
                  viewBox="0 0 24 24"
                  width="20"
                  height="20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </header>
            <div
              style={{
                minHeight: 0,
                overflowY: "auto",
                overscrollBehavior: "contain",
                padding: "clamp(14px, 2.5vw, 24px)",
              }}
            >
              {content}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
