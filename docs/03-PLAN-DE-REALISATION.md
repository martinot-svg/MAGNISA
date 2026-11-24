# Plan de réalisation et critères d'acceptation

## Lot 1 — Catalogue de services et tarification

- Ajouter les catégories de services rattachées à l'organisation.
- Autoriser la création d'une catégorie et de plusieurs services dans une transaction.
- Autoriser la création individuelle.
- Contrôler les unités à partir du référentiel `billing-units.ts`.
- Ajouter des règles de tarification horaires, journalières, par nuitée, participant, séance et forfait.
- Versionner les tarifs sans modifier les snapshots historiques.
- Tester deux organisations, accès croisés interdits, archivage et devis existants.

## Lot 2 — Réservation temporelle

- Inventorier les ressources réservables.
- Définir les fuseaux horaires et les périodes.
- Empêcher les chevauchements concurrents.
- Créer / modifier / annuler par RPC transactionnelles.
- Ajouter journal d'audit et tests de concurrence.

## Lot 3 — CRM approfondi

- Vérifier les statuts et les transitions prospect/client.
- Ajouter les contacts multiples si absents.
- Détection de doublons avec revue humaine (aucune fusion automatique destructive).
- Historique unifié et KPI par organisation.

## Lot 4 — Automatisation fiable

- Catalogue d'événements métier.
- Règles activables par organisation.
- Jobs avec clé d'idempotence, tentative, statut, résultat et prochaine reprise.
- Horloge et fuseau horaire explicites.
- Observabilité, alertes et dead-letter.
- Preuve E2E pour e-mail/push avant activation générale.

## Lot 5 — Analytics consolidés

- KPI ventes, encaissements, retard de paiement, marge et récurrence.
- Calculs fondés sur les données validées du serveur.
- Filtrage strict par organisation.
- Comparaisons de périodes et exports.
- Réconciliation avec les états comptables.

## Lot 6 — Portail client, signature et paiements

- Choisir et approuver les fournisseurs.
- Définir le modèle d'identité et d'accès client.
- Implémenter les webhooks signés et idempotents.
- Réconcilier chaque paiement avec facture, organisation et devise.
- Tester remboursements, doublons, échecs et révocation des accès.

## Lot 7 — Assistant IA

- Accès lecture seule aux indicateurs agrégés.
- Sources et période de calcul affichées.
- Pas d'accès aux secrets ni aux données d'autres organisations.
- Confirmation avant toute action.
- Tests de fuite inter-tenant et de prompt injection.

## Critères de clôture communs

Un lot est terminé uniquement lorsque :
1. le code est intégré aux pages et actions existantes ;
2. la migration rejoue depuis une base vide et une restauration de test ;
3. RLS et permissions sont testées avec au moins deux organisations ;
4. les cas de concurrence et d'idempotence sont testés ;
5. les tests unitaires, intégration, lint et build passent ;
6. les parcours E2E critiques passent ;
7. la documentation de déploiement et de retour arrière est fournie ;
8. aucun changement de production n'est fait sans approbation explicite.
