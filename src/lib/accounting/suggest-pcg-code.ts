/**
 * Suggestions prudentes de correspondance entre comptes métier MAGNISA et PCG 2005.
 *
 * Ces suggestions ne sont jamais appliquées automatiquement : l'utilisateur habilité
 * doit confirmer l'imputation après vérification de la pièce justificative.
 */
export function suggestPcgCode(accountLabel: string, accountKey: string): string {
  const value = `${accountLabel} ${accountKey}`.toLowerCase();
  const key = accountKey.trim().toUpperCase();

  // Les comptes TRANSIT représentent les fonds en cours de transfert entre comptes
  // de trésorerie. Le compte PCG 581 (Virements de fonds) est la correspondance dédiée.
  if (key.startsWith("TRANSIT:")) return "581";

  // Le matériel informatique durable relève généralement des immobilisations corporelles.
  if (/(ordinateur|matériel informatique|materiel informatique|équipement informatique|equipement informatique|matériel numérique|materiel numerique)/.test(value)) return "218";
  if (/(remboursement.*mvola|frais.*mvola.*reclasser)/.test(value)) return "471";
  return "";
}
