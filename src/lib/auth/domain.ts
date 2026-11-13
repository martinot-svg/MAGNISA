const DISPOSABLE_HINTS = [
  "mailinator", "tempmail", "10minutemail", "guerrillamail",
  "yopmail", "trashmail", "dispostable",
];

export function signupEmailPolicy(email: string) {
  const normalized = email.trim().toLowerCase();
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(normalized)) {
    return { ok: false, reason: "Adresse e-mail invalide." };
  }

  const at = normalized.lastIndexOf("@");
  const local = normalized.slice(0, at);
  const domain = normalized.slice(at + 1);
  if (
    !local || local.length > 64 || local.startsWith(".") || local.endsWith(".") ||
    local.includes("..") || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)
  ) {
    return { ok: false, reason: "Adresse e-mail invalide." };
  }
  const labels = domain.split(".");
  if (
    labels.length < 2 ||
    labels.some((label) =>
      !label || label.length > 63 ||
      !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
    ) ||
    labels[labels.length - 1].length < 2
  ) {
    return { ok: false, reason: "Le domaine de l'adresse e-mail est invalide." };
  }
  if (DISPOSABLE_HINTS.some((hint) => domain.includes(hint))) {
    return { ok: false, reason: "Les adresses e-mail temporaires ou jetables ne sont pas acceptées." };
  }

  // Tous les fournisseurs valides sont acceptés ; Google n'est jamais requis.
  return {
    ok: true,
    kind: domain === "gmail.com" ? "gmail" as const : "professional" as const,
    normalized,
  };
}

export function isAllowedSignupEmail(email: string) {
  return signupEmailPolicy(email).ok;
}
