/**
 * Identifiants magnibox strictement internes à MAGNISA.
 * Les boîtes internes sont repérées par leurs identifiants, pas par un domaine de courrier.
 */
export function normalizemagniboxNamespace(input: string): string {
  const slug = input.trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length < 2 || slug.length > 45) {
    throw new Error("Identifiant d'entreprise invalide (2 à 45 caractères, lettres, chiffres, tirets).");
  }
  return slug;
}

export function normalizemagniboxLocalPart(input: string): string {
  const alias = input.trim().toLowerCase();
  if (!/^[a-z][a-z0-9._-]{1,63}$/.test(alias)) {
    throw new Error("Nom de boîte invalide (2 à 64 caractères, sans arobase).");
  }
  return alias;
}

export function internalMailboxLabel(localPart: string, namespace: string): string {
  return `${normalizemagniboxLocalPart(localPart)} (${normalizemagniboxNamespace(namespace)})`;
}
