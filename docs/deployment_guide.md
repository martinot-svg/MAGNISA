# Guide d'intégration

## Avant toute intégration
- Créer une branche `integration/magnisa-upgrade`.
- Sauvegarder la base de test.
- Vérifier les noms et types des colonnes `organization_id`, `id` et `auth.uid()` dans le dépôt.
- Comparer les tables déjà existantes pour éviter les doublons.
- Tester toutes les migrations sur une base de développement.

## Déploiement
1. Copier uniquement les fichiers validés.
2. Appliquer les migrations dans l'ordre sur un projet Supabase de test.
3. Exécuter `npm test` (ou le script de test configuré dans le dépôt).
4. Vérifier l'isolation multi-tenant avec deux organisations différentes.
5. Vérifier les autorisations RBAC côté serveur ET RLS côté base.
6. Ouvrir une Pull Request et attendre la revue avant fusion.

## Attention
Ce paquet ne modifie pas automatiquement les routes UI existantes, les règles RBAC propres à MAGNISA, les tâches planifiées ni les écrans de reporting. Ces branchements doivent être réalisés après lecture des fichiers existants.
