/**
 * Suggest only mappings that are unambiguous from the legacy account key.
 *
 * Asset classification must never be inferred from a free-text description:
 * a durable asset requires an explicit fixed-asset operation and supporting
 * acquisition details. Ambiguous expense keys stay unmapped for review.
 */
export function suggestPcgCode(accountLabel: string, accountKey: string): string {
  const value = `${accountLabel} ${accountKey}`.toLowerCase();
  if (/(remboursement.*mvola|frais.*mvola.*reclasser)/.test(value)) return "471";
  return "";
}
