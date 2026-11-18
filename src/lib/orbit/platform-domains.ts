/** Tenant labels are generated from the configured company name, then editable by its admin. */
export function normalizeMagniboxTenantLabel(value: string): string {
  const label = value.trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(label) || label.length < 2 || label.length > 45) {
    throw new Error("L'identifiant public doit contenir 2 à 45 caractères : lettres, chiffres et tirets.");
  }
  return label;
}

export function suggestMagniboxTenantLabel(companyName: string): string {
  const slug = companyName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 45)
    .replace(/-+$/g, "");
  return slug.length >= 2 ? slug : "entreprise";
}
