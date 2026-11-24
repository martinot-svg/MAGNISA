# MAGNISA_UPGRADE — extension pack

Ce paquet est une base d'extension destinée à l'architecture Next.js / TypeScript / Supabase de MAGNISA.
Il ne s'agit pas d'un remplacement de l'application ni d'une déclaration que les huit phases sont déjà intégrées en production.

## Installation
1. Créer une branche dédiée.
2. Comparer chaque fichier avec le dépôt actuel avant toute copie.
3. Appliquer les migrations sur un environnement de test uniquement.
4. Exécuter les tests et vérifier les politiques RLS avant toute fusion.

Les migrations ci-dessous ajoutent des tables dédiées aux fonctionnalités manquantes sans modifier les tables existantes.
Les relations vers les entités métier existantes sont volontairement documentées comme des points d'intégration à adapter après vérification des schémas exacts du dépôt.

## Prérequis
- Next.js / TypeScript
- Supabase PostgreSQL
- Authentification Supabase
- RLS activée et vérifiée

## Contenu
- `database/migrations/`: fondations SQL isolées par organisation
- `src/lib/magnisa-upgrade/`: services TypeScript réutilisables
- `tests/`: tests unitaires de logique pure
- `docs/`: guide d'intégration et limites connues

Ne pas déployer directement en production sans revue des migrations, des permissions et des intégrations existantes.
