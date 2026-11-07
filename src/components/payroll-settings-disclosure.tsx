"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { ModalFrame } from "@/components/modal-frame";

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
  const openerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setActive(null);
    requestAnimationFrame(() => openerRef.current?.focus());
  }, []);

  const activeItem = items.find((item) => item.id === active);
  const content =
    active === "simulator" ? simulator : active === "create" ? createRule : history;

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
            ref={active === item.id ? openerRef : undefined}
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
      {active && activeItem ? (
        <ModalFrame title={activeItem.label} onClose={close} width="min(1120px, 100%)">
          {content}
        </ModalFrame>
      ) : null}
    </section>
  );
}
