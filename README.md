# MAGNISA — Extension Catalogue des prestations

Pack d'intégration pour le dépôt `martinot-svg/MAGNISA` (Next.js / TypeScript / Supabase).

> Extension isolée : elle ajoute ses propres tables et services. Elle ne remplace pas le catalogue existant et ne modifie aucune table métier existante. Les relations aux devis/factures doivent être raccordées après vérification des schémas réels de MAGNISA.

## Fonctionnalités

- Catégories de prestations par entreprise.
- Prestations rattachées à une catégorie.
- Unités : heure, nuit, jour, demi-journée, semaine, mois, forfait.
- Prix stockés en MGA (Ariary), TVA paramétrable.
- Activation/désactivation sans suppression physique.
- Contrôles de cohérence et tests de logique métier.
- Migration PostgreSQL avec index, contraintes et RLS.

## Arborescence

```text
database/migrations/20261124000100_service_catalogue.sql
src/lib/service-catalogue/types.ts
src/lib/service-catalogue/units.ts
src/lib/service-catalogue/validation.ts
src/lib/service-catalogue/repository.ts
src/lib/service-catalogue/price.ts
tests/service-catalogue.test.ts
docs/INTEGRATION.md
```

## Installation

1. Créer une branche dédiée, par exemple `feat/service-catalogue-categories`.
2. Comparer ce pack aux conventions et aux tables déjà présentes dans MAGNISA.
3. Vérifier impérativement le modèle réel des entreprises et les politiques d'accès multi-utilisateurs.
4. Appliquer la migration uniquement sur une base de test.
5. Générer/mettre à jour les types Supabase du projet.
6. Lancer les tests, le lint et le build.
7. Raccorder le catalogue aux formulaires de devis/factures en conservant un instantané du libellé, de l'unité, du prix et du taux de TVA sur chaque ligne commerciale.

## Point d'attention RLS

La migration fournie utilise `created_by = auth.uid()` comme politique minimale de propriétaire, faute de connaître le nom exact des tables d'appartenance entreprise/utilisateur dans la base MAGNISA. Ce n'est pas encore une politique multi-collaborateurs complète. Avant production, remplacer cette vérification par le mécanisme d'autorisation entreprise déjà utilisé dans MAGNISA.

## Commandes de vérification

Adapter aux scripts déjà présents dans le `package.json` de MAGNISA :

```bash
npm run lint
npm run test
npm run build
```

Le pack n'affirme pas que la fonctionnalité est déjà intégrée ou déployée. Il constitue une extension à intégrer et à valider dans le dépôt réel.
