# MAGNISA — Nouvelles améliorations (pack d'intégration)

Ce paquet complète le dépôt `martinot-svg/MAGNISA` sans remplacer ses modules existants.

**Référence du dépôt consultée :** branche `main`, commit `53758e20d68b1795117a0885a2e5c7b52147f8b7` (24 novembre 2026).

## Important — périmètre réel

Le dépôt contient déjà plusieurs domaines proposés dans la feuille de route : CRM, clients, prospects, services, devis, commandes, factures, paiements, prestations récurrentes, fournisseurs, stocks, approvisionnements, trésorerie, paie, fiscalité, comptabilité, rapports, notifications, audit et gestion des accès.

Le présent ZIP ne prétend donc pas réimplémenter ces modules. Il apporte :
- un référentiel centralisé de 17 unités de facturation ;
- des fonctions pures de calcul de prestations et de tarification ;
- des agrégateurs analytiques sans accès direct à la base ;
- des contrats d'automatisation et de clés d'idempotence ;
- des contrôles de cohérence multi-entreprises ;
- des tests unitaires et une feuille de route d'intégration.

Il ne contient **aucune migration SQL de production**, aucune nouvelle route UI, aucun connecteur de paiement, aucune signature électronique ni aucun portail client activé. Ces intégrations nécessitent les schémas, fournisseurs, règles métier et validations de sécurité propres au projet.

## Installation

Copier le dossier `src/lib/magnisa-next/` dans `src/lib/magnisa-next/` du dépôt.

Copier les tests dans `tests/magnisa-next/` ou les adapter à la convention de tests du dépôt.

Aucune dépendance supplémentaire n'est requise. Le projet utilise déjà TypeScript et Vitest.

## Vérifications

Depuis la racine de MAGNISA :

```bash
npm ci
npx vitest run tests/magnisa-next
npm run lint
npm run build
```

Les tests de ce paquet couvrent les fonctions pures uniquement. Ils ne remplacent pas les tests Supabase/RLS, les tests multi-tenant, les tests E2E ni les validations de migrations.

## Intégration du catalogue

Le fichier `billing-units.ts` est un référentiel applicatif. Avant de remplacer les champs `unit` existants, il faut :
1. inventorier les unités actuellement utilisées dans les services et documents ;
2. établir une correspondance sans perte ;
3. préserver les libellés historiques des devis, commandes et factures ;
4. migrer les valeurs uniquement après validation sur une copie de base ;
5. remplacer la saisie libre dans les formulaires `/services` par une liste contrôlée ;
6. vérifier les actions serveur `createService` et `updateService`.

## Règles de sécurité

- Ne jamais utiliser un `organization_id` fourni par le navigateur comme preuve d'autorisation.
- Résoudre l'organisation active côté serveur avec les mécanismes déjà présents dans MAGNISA (`requireOrganization`).
- Continuer à appliquer les permissions existantes et les politiques RLS.
- Les fonctions de ce paquet ne remplacent pas les contrôles serveur.
- Ne jamais réécrire les prix figés dans les documents historiques.
