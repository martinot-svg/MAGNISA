/**
 * Suggest only mappings that are unambiguous from the legacy account key.
 *
 * Asset classification must never be inferred from a free-text description:
 * a durable asset requires an explicit fixed-asset operation and supporting
 * acquisition details. Ambiguous expense keys stay unmapped for review.
 */
export function isPcgMappingAllowed(accountKey: string, pcgKind: string): boolean {
  return !/^EXPENSE:/i.test(accountKey.trim()) || pcgKind === "expense";
}

export function suggestPcgCode(accountLabel: string, accountKey: string): string {
  const value = `${accountLabel} ${accountKey}`.toLowerCase();
  if (/^TRANSIT:/.test(accountKey.trim()) || /fonds en transit/.test(value)) return "581";
  if (/(remboursement.*mvola|frais.*mvola.*reclasser)/.test(value)) return "471";
  return "";
}
