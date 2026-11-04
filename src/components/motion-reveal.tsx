"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";

/* Révélation au scroll, une seule fois par élément.
   Cible uniquement des surfaces de présentation (en-têtes, cartes de synthèse,
   sections publiques) : jamais les tableaux, formulaires, modales ni le tableau de bord
   (qui possède ses propres animations). Aucune donnée n'est lue ni modifiée. */
const SELECTOR = [
  ".appShell main .pageHead",
  ".appShell main .grid4>.card",
  ".appShell main .grid3>.card",
  ".appShell main .grid2>.card",
  ".featurePanel",
  ".publicSection .sectionIntro",
].join(",");

export function MotionReveal(): null {
  const pathname = usePathname();

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!("IntersectionObserver" in window)) return;

    const els = Array.from(document.querySelectorAll<HTMLElement>(SELECTOR)).filter(
      (el) =>
        !el.hasAttribute("data-mg-reveal") &&
        !el.closest("table,dialog,[role=dialog],.magnisa-dashboard,form"),
    );
    if (!els.length) return;

    const done = (el: HTMLElement) => {
      el.classList.add("is-in");
      // Retire l'attribut après la transition pour ne pas interférer avec les survols.
      window.setTimeout(() => {
        el.removeAttribute("data-mg-reveal");
        el.classList.remove("is-in");
        el.style.removeProperty("--mg-delay");
      }, 900);
    };

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          io.unobserve(entry.target);
          done(entry.target as HTMLElement);
        });
      },
      { threshold: 0.1, rootMargin: "0px 0px -4% 0px" },
    );

    els.forEach((el, i) => {
      el.setAttribute("data-mg-reveal", "");
      el.style.setProperty("--mg-delay", `${Math.min(i % 6, 5) * 45}ms`);
      io.observe(el);
    });

    // Filet de sécurité : aucun contenu ne reste masqué.
    const failsafe = window.setTimeout(() => {
      els.forEach((el) => {
        if (el.hasAttribute("data-mg-reveal")) done(el);
      });
    }, 2500);

    return () => {
      io.disconnect();
      window.clearTimeout(failsafe);
      els.forEach((el) => {
        el.removeAttribute("data-mg-reveal");
        el.classList.remove("is-in");
      });
    };
  }, [pathname]);

  return null;
}
