const DISPOSABLE_HINTS = ["mailinator", "tempmail", "10minutemail", "guerrillamail", "yopmail", "trashmail", "dispostable"];

export function signupEmailPolicy(email: string) {
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  if (at <= 0 || at === normalized.length - 1 || normalized.indexOf("@") !== at) {
    return { ok: false, reason: "Adresse e-mail invalide." };
  }
  const domain = normalized.slice(at + 1);
  if (!domain.includes(".") || domain.startsWith(".") || domain.endsWith(".") || domain.split(".").some(part => !part)) {
    return { ok: false, reason: "Le domaine de l'adresse e-mail est invalide." };
  }
  if (DISPOSABLE_HINTS.some(hint => domain === hint || domain.includes(hint))) {
    return { ok: false, reason: "Les adresses e-mail temporaires ou jetables ne sont pas acceptées." };
  }
  return { ok: true, kind: "email" as const, normalized };
}

export function isAllowedSignupEmail(email: string) { return signupEmailPolicy(email).ok; }
