# MAGNISA — Lot 2/3/4/9 : recette de rapprochement et contrôle RBAC
Date : 2026-10-16
Branche : lot1-securite-financiere
Base d'exécution : MAGNISA-TEST / jrotsmzkyjsibmbnqxtz
Production : inchangée
MAGNIMAIL : exclu des modifications

## Réalisation
- Migration `20261016170000_financial_reconciliation_diagnostics.sql` ajoutée et appliquée sur TEST.
- Trois vues SQL invoker-RLS, sans écriture : `magnisa_invoice_reconciliation`, `magnisa_supplier_reconciliation`, `magnisa_account_reconciliation`.
- Factures clients : rapprochement total = payé + reste dû ET payé = somme des paiements confirmés/réconciliés.
- Fournisseurs : rapprochement total = payé + reste dû ET payé = somme des paiements fournisseurs.
- Trésorerie : solde de compte = somme des mouvements financiers, avec signalement explicite des possibles soldes d'ouverture non matérialisés dans le journal.
- Comptabilité : affichage des anomalies, des volumes analysés et de leurs écarts par entité ; aucune régularisation automatique susceptible d'effacer une trace.
- Administration : `assertPermission` et `hasPermission` refusent l'accès si la lecture des règles échoue (fail-closed).

## Résultats SQL obtenus sur MAGNISA-TEST
- 3 factures clients : statut `ok` ; 0 écart pour les données testées.
- 1 compte financier : statut `ok` ; 0 écart.
- 0 facture fournisseur dans le jeu actuel : pas de validation du cas fournisseur avec données réelles.
- PCG 2005 : 0 anomalie de balance dans la vue d'intégrité sur le jeu de données actuel ; 0 imputation `NON_CLASSE` sur celui-ci ; le catalogue PCG reste partiel.
- Invoker RLS : `reloptions = ['security_invoker=true']` sur les 3 vues.
- Utilisateur authentifié simulé sans appartenance : 0 ligne dans les 3 vues.
- Rôle `anon` : accès à la vue facture refusé `permission denied`, résultat attendu.
- Le déploiement de la migration ne modifie aucune ligne métier.

## Limites et risques à traiter avant la promotion en production
- Contrôles de soldes ne remplacent pas la comptabilité de stocks, les avoirs, l'ouverture comptable, les écritures d'inventaire et la clôture.
- Les factures avec avoirs ou remises post-émission doivent être traitées selon leur vraie règle métier : examiner les écarts détectés, ne pas écraser les soldes.
- Les vues `security_invoker` dépendent des permissions et RLS existantes sur les tables sources, à confirmer avec les rôles réels.
- Auth JWT signé et navigateur responsive/interactions non couverts par les requêtes SQL.
- Les taux sociaux et fiscaux, la paie et les états PCG 2005 réglementaires nécessitent une validation professionnelle et une recension de la réglementation en vigueur.
- La check-list générale `docs/promotion-production-lots-2-10-checklist.md` reste contraignante.

## Référence normative
PCG 2005 (Madagascar), décret n°2004-272 : art. 121-3 (exercice), 123-8 (non compensation), 210-1 (états), 338-2/338-3 (prestations de service), 420-1 à 420-4 (écritures et pièces), 430-1/430-2 (livres, contrôle informatique).
Document fourni par le propriétaire du projet. L'édition historique ne suffit pas à valider l'entièreté du droit fiscal courant.

**Décision : tests ciblés réussis ; non prétendu 100 % sur l'ensemble des lots. Aucun déploiement production.**
