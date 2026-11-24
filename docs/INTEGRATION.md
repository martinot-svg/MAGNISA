# Guide d'intégration MAGNISA

## 1. Navigation proposée

Dans le module **Ventes** :

- Catalogue
  - Catégories de prestations
  - Prestations

Ne pas créer un module autonome supplémentaire.

## 2. Modèle de données

`service_categories` représente les familles (ex. Informatique, Communication, Formation).

`service_catalogue` représente les prestations vendables (ex. Maintenance informatique, Community Management). Chaque prestation appartient à une catégorie et possède une unité, un prix MGA et un taux de TVA.

Les unités sont stockées avec un code stable :
- `HOUR` — Heure
- `NIGHT` — Nuit
- `DAY` — Jour
- `HALF_DAY` — Demi-journée
- `WEEK` — Semaine
- `MONTH` — Mois
- `PACKAGE` — Forfait (prix global en MGA)

## 3. Raccordement devis / factures

Lorsqu'une prestation est ajoutée à un devis ou à une facture, ne pas dépendre uniquement d'une jointure dynamique vers le catalogue. Enregistrer dans la ligne commerciale un instantané des champs suivants :

- `catalogue_service_id` (nullable, référence informative)
- `description` / `label`
- `unit_code` et `unit_label`
- `quantity`
- `unit_price_mga`
- `vat_rate`
- `subtotal_mga`, `tax_mga`, `total_mga`

Ainsi, une modification ultérieure du catalogue ne réécrit jamais les documents déjà émis.

Pour une prestation au forfait, la quantité est normalement `1`, mais le modèle autorise d'autres quantités si le forfait est vendu plusieurs fois.

## 4. Adaptations obligatoires avant production

1. Vérifier les tables et fonctions d'autorisation entreprise déjà présentes dans MAGNISA.
2. Remplacer la RLS `created_by = auth.uid()` par le contrôle d'appartenance/permission entreprise utilisé dans le projet.
3. Ajouter une contrainte ou un trigger garantissant que `category_id` et `company_id` appartiennent toujours à la même entreprise, y compris lors d'une mise à jour.
4. Vérifier les conventions de migration et le schéma généré TypeScript du dépôt.
5. Raccorder les pages aux composants UI et aux conventions de formulaire déjà utilisés par MAGNISA.
6. Raccorder les lignes du catalogue aux écritures comptables via le mécanisme existant, sans coder de comptes arbitraires dans le catalogue.
7. Exécuter tests, lint, typecheck et build.

## 5. Sécurité et conservation

- Aucun endpoint ne doit accepter un `company_id` sans vérifier que l'utilisateur courant peut agir sur cette entreprise.
- Les enregistrements utilisés dans des devis/factures ne doivent pas être supprimés physiquement.
- Désactiver une catégorie/prestation plutôt que la supprimer.
- Les documents commerciaux doivent conserver leur instantané historique.
- Ne jamais exposer une clé Supabase `service_role` dans le navigateur.
