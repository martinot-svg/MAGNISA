/** Transitions courtes et partagées, sans mouvement imposé aux utilisateurs sensibles. */
export const motionTiming = {
  fast: { duration: 0.16, ease: "easeOut" as const },
  standard: { duration: 0.22, ease: "easeOut" as const },
  modal: { type: "spring" as const, stiffness: 340, damping: 34, mass: 0.8 },
  none: { duration: 0 },
};
export const motionVariants = {
  fade: { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } },
  slideUp: { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -5 } },
  scaleIn: { initial: { opacity: 0, scale: .99 }, animate: { opacity: 1, scale: 1 }, exit: { opacity: 0, scale: .99 } },
  stagger: { animate: { transition: { staggerChildren: 0.035 } } },
};
