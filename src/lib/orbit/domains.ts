import { domainToASCII } from "node:url";

/** Syntax validation is NOT DNS verification, domain ownership, or mail activation. */
export function normalizeOrbitDomain(value: string): string {
  const raw = value.trim().toLowerCase();
  if (!raw || raw.endsWith(".") || raw.includes("@") || /[\s/:?#]/.test(raw)) {
    throw new Error("Nom de domaine professionnel invalide.");
  }
  const domain = domainToASCII(raw);
  const labels = domain.split(".");
  if (domain.length < 4 || domain.length > 253 || labels.length < 2 ||
      labels.some(label => label.length < 1 || label.length > 63 ||
        !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)) ||
      labels.at(-1)!.length < 2) {
    throw new Error("Nom de domaine professionnel invalide.");
  }
  return domain;
}

/** Common SMTP-compatible ASCII mailbox names; provider-specific quoting is not provisioned. */
export function normalizeOrbitLocalPart(value: string): string {
  const part = value.trim().toLowerCase();
  if (!part || part.length > 64 || !/^[a-z0-9](?:[a-z0-9._+-]*[a-z0-9])?$/.test(part) ||
      part.includes("..")) {
    throw new Error("Nom d'adresse professionnelle invalide.");
  }
  return part;
}

export function normalizeOrbitPublicAddress(value: string): {
  email: string; domain: string; localPart: string;
} {
  const parts = value.trim().split("@");
  if (parts.length !== 2) throw new Error("Adresse professionnelle invalide.");
  const localPart = normalizeOrbitLocalPart(parts[0]);
  const domain = normalizeOrbitDomain(parts[1]);
  if ((localPart + "@" + domain).length > 254) throw new Error("Adresse professionnelle trop longue.");
  return { email: localPart + "@" + domain, domain, localPart };
}
