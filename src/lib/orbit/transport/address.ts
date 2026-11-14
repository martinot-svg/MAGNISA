/**
 * Deliberately restrict domain and mailbox syntax to compatible ASCII.
 * This validates input only: it does not assert ownership, availability or
 * server-side sender permission. A .mgmail mailbox is not Internet-routable.
 */
const PUBLIC_ADDRESS = /^[a-z0-9][a-z0-9.!#$%&'*+/=?^_`{|}~-]*@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i;
export function normalizePublicEmail(input: string): string {
  const value = input.trim().toLowerCase();
  if (value.length > 254 || value.includes("\r") || value.includes("\n")
    || !PUBLIC_ADDRESS.test(value) || value.includes("..")
    || value.endsWith(".mgmail")) {
    throw new Error("Adresse de courrier Internet invalide.");
  }
  return value;
}
export function parsePublicRecipients(input: string): string[] {
  if (input.length > 2000) throw new Error("Liste de destinataires trop longue.");
  const addresses = input.split(/[;,]/).map(s=>s.trim()).filter(Boolean);
  if (addresses.length < 1 || addresses.length > 10) {
    throw new Error("Entre un et dix destinataires sont requis.");
  }
  const normalized = addresses.map(normalizePublicEmail);
  if (new Set(normalized).size !== normalized.length) {
    throw new Error("Les destinataires doivent être distincts.");
  }
  return normalized;
}
export function normalizeHeaderFrom(input: string): string {
  const candidate = input.trim().match(/<([^<>]+)>$/);
  return normalizePublicEmail(candidate ? candidate[1] : input);
}
