# MAGNISA - Vérification des 32 modèles documentaires (20 octobre 2026)

**Branche :** `test/document-library-32-validation`
**Statut :** recettage automatisé réussi, recette utilisateur complète et déploiement de ce lot non validés.
**Preuves :** [GitHub Actions, exécution 39386223370](https://github.com/martinot-svg/MAGNISA/actions/runs/39386223370), [pull request #4](https://github.com/martinot-svg/MAGNISA/pull/4).

## Réalisations effectivement vérifiées

| Élément | Résultat |
| --- | --- |
| Catalogue source MAGNISA | 32 variantes originales : 8 factures, 8 devis, 8 bulletins, 8 rapports |
| Vitest | 859 tests réussis, 11 fichiers |
| Génération réelle par `@react-pdf/renderer` | 32/32 fichiers PDF techniquement valides |
| Contrôle de page et texte | 32/32 PDF, toutes leurs pages : A4, couche texte, pas de débordement de texte hors page détecté |
| Copies d'impression | PNG de toutes les pages générés en CI |
| Insertion logo et masquage | 8/8 PDF tests : quatre familles, activé/désactivé, dimensions source préservées |
| Compilation Next.js | Réussie |
| API directes simulées | Refus d'exports de documents / paie / rapports / e-mails par les rôles non autorisés et document étranger introuvable |
| Isolation RLS sur base éphémère | Refus interentreprises et refus au lecteur de l'organisation ; consultation autorisée au propriétaire |
| Historique de présentation | Sept révisions conservées, restauration précédente crée une nouvelle révision |
| Sauvegarde/restauration sur base éphémère | Dump PostgreSQL restauré, trois révisions et configuration retrouvées |
| Isolation Supabase production | Uniquement contrôle RLS de lecture en transaction annulée sur trois couples utilisateur / organisation |

## Modifications préparées (non fusionnées)

- `src/lib/pdf/report.ts` : extraction du composant PDF de rapport pour les tests et réutilisation.
- `src/lib/pdf/document.tsx`, `src/lib/pdf/payslip.tsx`, `src/lib/pdf/report.ts` : affichage de l'identité visuelle, positionnement et conservation des proportions du logo.
- `src/lib/payroll/payslip-document.ts` et route PDF rapport : logo issu de la configuration de l'organisation.
- `src/app/(app)/parametres/page.tsx` : conserve les anciens fichiers de logo pour éviter de casser les références documentaires historiques.
- `src/app/(app)/modeles-documents/page.tsx` : configuration visibilité du logo et garde d'autorisation.
- `src/lib/template-lifecycle.ts` et écran `modeles-documents/historique` : opérations de statut et restauration avec confirmation et contrôle des droits.
- `supabase/migrations/20261020100000_document_template_versions.sql` : migration additive testée en base isolée ; **non appliquée à la production**.
- `tests/integration/` : essais SQL RLS, sauvegarde, comparaison PDF et captures.
- `.github/workflows/ci.yml` : chaîne de tests PDF + PostgreSQL à chaque changement.

## Limites critiques restant à confirmer avant validation intégrale

1. **Sessions HTTP réellement authentifiées** : les tests de routes utilisent une authentification simulée. Aucun parcours avec plusieurs cookies/sessions Supabase réels n'a été réalisé.
2. **Rendu PDF sur imprimantes et inspection humaine** : les images et tests de géométrie sont disponibles, mais l'absence de chevauchements visuels, la lisibilité d'impression et la cohérence complète aperçu/PDF n'ont pas été certifiées manuellement pour chaque page.
3. **Historique de documents déjà finalisés** : des documents anciens n'ont pas systématiquement de capture historique originelle ; aucun inventaire probant de 100 % de leur fidélité n'est disponible.
4. **Sécurité de tout le logiciel** : contrôles intégrés aux chemins concernés, mais couverture serveur exhaustive des 17 permissions et de toutes les opérations de modèles non atteinte.
5. **Sauvegarde réelle de production** : l'exercice a été exécuté sur base éphémère, pas à partir d'une sauvegarde de production restaurée.
6. **Performance p95 / charge** : non mesurée.
7. **Conformité réglementaire** : aucun audit humain complet par type de document et juridiction.

**Décision :** ne pas annoncer 100 % de conformité ni activer cette nouvelle migration ou fusionner la PR #4 tant que les contrôles critiques non vérifiés persistent. Les données financières, comptes existants et documents réels n'ont pas été modifiés par ce lot.
