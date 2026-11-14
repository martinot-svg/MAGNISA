// Personal and professional email providers are equally valid for MAGNISA accounts.
// Only temporary/disposable services are excluded.
const DISPOSABLE_HINTS = [
  "mailinator",
  "tempmail",
  "10minutemail",
  "guerrillamail",
  "yopmail",
  "trashmail",
  "dispostable",
];

export function signupEmailPolicy(email: string) {
  const normalized = email.trim().toLowerCase();
  const parts = normalized.split("@");
  if (
    parts.length !== 2 ||
    !parts[0] ||
    !parts[1] ||
    parts[0].length > 64 ||
    normalized.length > 254 ||
    /\s/.test(normalized)
  ) {
    return { ok: false, reason: "Adresse e-mail invalide." };
  }

  const domain = parts[1];
  const labels = domain.split(".");
  if (
    domain.length > 253 ||
    labels.length < 2 ||
    labels.some((label) => !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label))
  ) {
    return { ok: false, reason: "Adresse e-mail invalide." };
  }

  if (DISPOSABLE_HINTS.some((hint) => domain.includes(hint))) {
    return {
      ok: false,
      reason: "Les adresses e-mail temporaires ou jetables ne sont pas acceptées.",
    };
  }

  return { ok: true, kind: "email" as const, normalized };
}

export function isAllowedSignupEmail(email: string) {
  return signupEmailPolicy(email).ok;
}
