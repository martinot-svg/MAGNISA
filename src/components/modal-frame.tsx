"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { motion, useReducedMotion } from "motion/react";

type ModalFrameProps = {
  title: string;
  children: ReactNode;
  onClose: () => void;
  width?: string;
  /** Prevent closing while a server operation is pending. */
  isBusy?: boolean;
  /** Backdrop dismissal is opt-in so form data is not discarded accidentally. */
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
};

export function ModalFrame({
  title,
  children,
  onClose,
  width = "min(820px, 100%)",
  isBusy = false,
  closeOnBackdrop = false,
  closeOnEscape = true,
}: ModalFrameProps) {
  const titleId = useId();
  const reducedMotion = useReducedMotion();
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const isBusyRef = useRef(isBusy);
  const closeOnEscapeRef = useRef(closeOnEscape);
  onCloseRef.current = onClose;
  isBusyRef.current = isBusy;
  closeOnEscapeRef.current = closeOnEscape;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const modalLayer = dialogRef.current?.parentElement;
    const backgroundElements = Array.from(document.body.children).filter(
      (element): element is HTMLElement => element instanceof HTMLElement && element !== modalLayer,
    );
    const previousBackgroundState = backgroundElements.map((element) => ({
      element,
      inert: element.inert,
      ariaHidden: element.getAttribute("aria-hidden"),
    }));
    backgroundElements.forEach((element) => {
      element.inert = true;
      element.setAttribute("aria-hidden", "true");
    });
    document.body.style.overflow = "hidden";

    const focusableSelector =
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const firstFocusable = dialogRef.current?.querySelector<HTMLElement>(focusableSelector);
    (firstFocusable ?? dialogRef.current)?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (closeOnEscapeRef.current && !isBusyRef.current) {
          event.preventDefault();
          onCloseRef.current();
        }
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;

      const nodes = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector),
      ).filter((node) => !node.hasAttribute("hidden") && node.getAttribute("aria-hidden") !== "true");

      if (!nodes.length) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }

      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      previousBackgroundState.forEach(({ element, inert, ariaHidden }) => {
        element.inert = inert;
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      });
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  return createPortal(
    <div
      role="presentation"
      className="magnisa-modal-backdrop"
      onMouseDown={(event) => {
        if (closeOnBackdrop && !isBusy && event.target === event.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "clamp(10px, 3vw, 28px)",
        background: "rgba(15, 23, 42, .48)",
        backdropFilter: "blur(5px)",
        WebkitBackdropFilter: "blur(5px)",
      }}
    >
      <motion.section
        initial={reducedMotion ? false : { opacity: 0, y: 10, scale: .99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: reducedMotion ? 0 : .2, ease: "easeOut" }}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={isBusy}
        tabIndex={-1}
        className="card magnisa-modal-panel"
        style={{
          display: "flex",
          flexDirection: "column",
          width,
          maxWidth: "100%",
          maxHeight: "min(92vh, 960px)",
          minHeight: 0,
          overflow: "hidden",
          padding: 0,
          background: "var(--card, #fff)",
          color: "var(--ink, #172033)",
          borderRadius: 18,
          boxShadow: "0 24px 80px rgba(0, 0, 0, .28)",
        }}
      >
        <header
          style={{
            flex: "0 0 auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            padding: "16px 20px",
            borderBottom: "1px solid var(--line, #e5e7eb)",
            background: "var(--card, #fff)",
          }}
        >
          <h2 id={titleId} style={{ margin: 0, fontSize: 18, lineHeight: 1.35 }}>{title}</h2>
          <button
            ref={closeRef}
            type="button"
            className="button"
            onClick={onClose}
            aria-label="Fermer la fenêtre"
            title="Fermer"
            disabled={isBusy}
            style={{ width: 40, height: 40, minWidth: 40, padding: 0, flex: "0 0 40px" }}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>
        <div style={{ minHeight: 0, overflowY: "auto", overscrollBehavior: "contain", padding: "clamp(14px, 2.5vw, 24px)" }}>
          {children}
        </div>
      </motion.section>
    </div>,
    document.body,
  );
}
