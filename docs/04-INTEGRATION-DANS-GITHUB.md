# Intégration dans GitHub

1. Télécharger et décompresser l'archive.
2. Créer une branche dédiée, par exemple `feat/magnisa-next-enhancements`.
3. Copier le contenu de `src/lib/magnisa-next/` dans le même chemin du dépôt.
4. Copier `tests/magnisa-next/` dans le dépôt.
5. Copier le dossier `docs/` dans un dossier documentaire dédié ou fusionner les documents après revue.
6. Lancer les tests listés dans le README.
7. Ouvrir une Pull Request.
8. Ne pas appliquer de migration ni déployer en production à partir de ce paquet : aucune migration de production n'est incluse.

## Intégrations applicatives encore nécessaires

- Brancher le référentiel d'unités dans les formulaires de création et modification de `/services`.
- Adapter et valider les actions serveur `createService` et `updateService`.
- Créer le modèle de catégories après inventaire du schéma et des règles RLS existantes.
- Brancher les agrégateurs analytiques à des requêtes serveur déjà filtrées par organisation.
- Créer les tables/RPC/jobs d'automatisation après revue du moteur de notifications et du scheduler existants.

## Limite

Un ZIP de fichiers ne peut pas prouver qu'une application complète est opérationnelle. La validation finale exige l'exécution dans le dépôt complet avec les variables d'environnement de test et une base Supabase isolée.
