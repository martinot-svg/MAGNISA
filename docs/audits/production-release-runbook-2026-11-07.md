# MAGNISA - plan de bascule production (7 novembre 2026)

## État de départ vérifié

Projet Supabase : `pmlzirobpdlzsrvtkvir`  
Projet Vercel : `magnisa`  
Branche de livraison : `fix/payroll-delete-dashboard-null-20261107`  
PR : https://github.com/martinot-svg/MAGNISA/pull/104

Le commit applicatif testé est `9aebbd22492ab996824098e3e271aa3042efe80a`. Le commit suivant n'ajoute que le script SQL de préflight et ce runbook.

## Écarts de schéma confirmés en production

Les éléments suivants manquent encore dans le schéma actuellement utilisé par l'application :

- RPC `archive_payroll_rule(uuid,uuid)`.
- Plafond de déduction santé à 2 % dans le trigger `payroll_compute_fmfp_on_insert`.
- Colonnes `taxable_supplementary_pension` dans `payslips` et `payroll_variable_drafts`.
- Nouvelle signature de `create_payslip` avec retraite complémentaire.
- Garde contre deux référentiels validés ayant la même date d'effet.
- Colonne `recurring_service_contracts.billing_timing` et RPC de contrat récurrent étendue.
- Table `accounting_fiscal_years` et RPC d'ouverture / clôture d'exercice.
- RPC `delete_payroll_rule_draft(uuid,uuid,text)`.

Éléments déjà présents ou déjà alignés :

- `payroll_legal_documents` existe, RLS activé, sans privilège de lecture pour `anon` ou `authenticated`.
- La politique `organization_members.member_select` existe.
- `lot1_financial_idempotency.updated_at` existe.
- Les lignes de journal PCG et les mécanismes d'intégrité comptable existent.
- Aucun doublon de date de début ni chevauchement de périodes validées n'a été détecté dans les référentiels de paie actuels.

## Ordre de migration candidat

Ne pas appliquer les fichiers par simple différence de noms ou de timestamps : l'historique Supabase contient des migrations enregistrées sous des versions et noms historiques différents. Utiliser le script `docs/audits/production-release-preflight-2026-11-07.sql` et réconcilier chaque migration avec les objets réellement présents.

Après cette réconciliation, l'ordre fonctionnel candidat est :

1. `20261022230000_recurring_billing_timing.sql` - mode de facturation en avance / à terme échu.
2. `20261105100000_accounting_fiscal_year_opening_closing.sql` - exercices, a-nouveaux et clôture contrôlée.
3. `20261105160000_add_updated_at_to_financial_idempotency.sql` - idempotent, colonne déjà présente à la dernière vérification.
4. `20261106120000_add_controlled_payroll_rule_archival.sql` - archivage explicite et contrôlé.
5. `20261106130000_fix_irsa_health_deduction_limit.sql` - alignement du trigger sur la déduction santé plafonnée à 2 %.
6. `20261106140000_add_taxable_supplementary_pension_and_balance_payroll_posting.sql` - retraite complémentaire imposable et écritures équilibrées.
7. `20261106150000_harden_anon_grants_and_payroll_rule_activation.sql` - retrait des privilèges `anon` et garde de date d'effet identique.
8. `20261106160000_reconstruct_private_payroll_legal_archive.sql` - migration idempotente ; table déjà présente.
9. `20261106170000_restore_organization_member_self_read_policy.sql` - migration idempotente ; politique déjà présente.
10. `20261107100000_delete_payroll_rule_draft_rpc.sql` - suppression contrôlée avec audit.

Les étapes 3, 8 et 9 peuvent être sans effet structurel si le préflight confirme toujours l'état constaté. Elles ne doivent toutefois être enregistrées comme appliquées qu'après vérification de leur historique.

## Bascule applicative et base

**Ne pas déployer le code paie et le trigger fiscal séparément.**

Le trigger de production calcule encore l'assiette IRSA en déduisant toute la cotisation santé. Le candidat applique le plafond légal de 2 %. Si la migration SQL est appliquée avant le code candidat, l'ancien calcul applicatif peut être rejeté lors de la création d'un bulletin.

Ordre de bascule recommandé :

1. Choisir une fenêtre de maintenance courte et suspendre temporairement les écritures de paie et la génération automatique de factures récurrentes.
2. Exécuter le préflight et sauvegarder / vérifier les points de restauration disponibles.
3. Appliquer uniquement les migrations réconciliées, dans l'ordre validé, sans recalculer les bulletins existants.
4. Déployer le commit applicatif testé.
5. Exécuter les tests de fumée sur une organisation de test : création d'un brouillon, calcul IRSA, validation du bulletin, écriture débit/crédit, archivage, suppression auditée, exercice comptable et facturation récurrente.
6. Vérifier à nouveau les privilèges `anon`, RLS, les fonctions RPC et les journaux.
7. Réactiver les écritures et les traitements planifiés.

## Protection des données et retour arrière

- Aucune mise à jour globale des bulletins historiques n'est autorisée dans cette bascule.
- La nouvelle colonne retraite complémentaire reçoit `0` par défaut ; les anciens bulletins ne sont pas recalculés.
- Ne supprimer aucune règle validée, écriture de journal, pièce source ou donnée d'organisation.
- Ne pas revenir à l'ancien code paie après activation du nouveau trigger IRSA sans procédure de compatibilité dédiée.
- Si un contrôle échoue, arrêter la bascule et conserver l'application en maintenance plutôt que de contourner une contrainte de sécurité ou de comptabilité.

## Sources réglementaires

La déduction de cotisation ouvrière santé est plafonnée à 2 % du salaire brut selon l'article 01.03.09, 2° du CGI publié par la DGI :
- https://portal.impots.mg/textes/textes/2024-12-18--N-025-2024-MEF-Ref-VDXBIA-4UW3VY.pdf
- https://portal.impots.mg/textes/textes/2025-02-06--N-2025-MEF.SG.DGI-Ref-HIH9EC-3OPLT3.pdf

Les autres taux, plafonds et paramètres contractuels doivent rester à vérifier auprès des sources officielles compétentes avant activation.
