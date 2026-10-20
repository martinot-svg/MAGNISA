"use client";

import { useEffect } from "react";

/**
 * Adds immediate native-HTML validation feedback to forms across the app.
 * Server actions must still validate every field and permission independently.
 */
export function FormValidityGuard() {
  useEffect(() => {
    const syncForm = (form: HTMLFormElement) => {
      const submitters = form.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
        'button[type="submit"], button:not([type]), input[type="submit"]',
      );

      for (const submitter of submitters) {
        if (form.noValidate) {
          if (submitter.dataset.validityDisabled === "true") {
            submitter.disabled = false;
            delete submitter.dataset.validityDisabled;
          }
          continue;
        }

        const valid = form.checkValidity();
        if (!valid && !submitter.disabled) {
          submitter.disabled = true;
          submitter.dataset.validityDisabled = "true";
        } else if (valid && submitter.dataset.validityDisabled === "true") {
          submitter.disabled = false;
          delete submitter.dataset.validityDisabled;
        }
      }
    };

    const syncAllForms = () => {
      document.querySelectorAll<HTMLFormElement>("form").forEach(syncForm);
    };
    const syncFromEvent = (event: Event) => {
      const target = event.target;
      if (target instanceof Element) {
        const form = target.closest("form");
        if (form instanceof HTMLFormElement) syncForm(form);
      }
    };
    const onReset = (event: Event) => {
      const form = event.target;
      if (form instanceof HTMLFormElement) queueMicrotask(() => syncForm(form));
    };

    syncAllForms();
    document.addEventListener("input", syncFromEvent, true);
    document.addEventListener("change", syncFromEvent, true);
    document.addEventListener("reset", onReset, true);

    // Next.js client navigation can mount forms after this component has loaded.
    const observer = new MutationObserver((records) => {
      if (records.some((record) => record.addedNodes.length > 0)) syncAllForms();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      document.removeEventListener("input", syncFromEvent, true);
      document.removeEventListener("change", syncFromEvent, true);
      document.removeEventListener("reset", onReset, true);
      observer.disconnect();
    };
  }, []);

  return null;
}
