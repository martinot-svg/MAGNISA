# MAGNISA — Dossier maître de mise à jour

**Version du dossier :** 1.0  
**Dépôt cible :** `martinot-svg/MAGNISA`  
**Branche de référence auditée :** `main`  
**Nature du paquet :** spécifications fonctionnelles, techniques, sécurité, tests et déploiement.

## Objectif

Ce dossier décrit les phases nécessaires pour faire évoluer le parcours d'inscription personnel, le choix d'utilisation de MAGNISA et la création d'une organisation, en réutilisant les mécanismes déjà présents dans le dépôt.

Il est conçu pour être ajouté à la racine du dépôt GitHub. Il ne remplace pas le code applicatif et ne lance aucune migration.

## Important — contenu du ZIP

Ce paquet est un **dossier de spécifications prêt à déposer dans GitHub**, pas un patch logiciel déjà implémenté. Il ne contient volontairement :
- aucune migration SQL exécutable ;
- aucun remplacement des composants existants ;
- aucune suppression de table, colonne, fonction, trigger ou policy ;
- aucune modification de RLS ;
- aucun secret, clé Supabase ou donnée utilisateur.

Les migrations et changements de code ne doivent être écrits qu'après audit complet des références, du schéma réellement déployé et des politiques d'accès.

## Installation documentaire

1. Télécharger et décompresser le ZIP.
2. Copier le dossier `MAGNISA_UPDATE_PACK/` à la racine de `martinot-svg/MAGNISA`.
3. Committer les documents sur une branche dédiée, par exemple `docs/magnisa-onboarding-update-plan`.
4. Utiliser `08_BACKLOG_IMPLEMENTATION.md` comme liste de suivi.
5. Implémenter les phases dans l'ordre et faire valider chaque porte de sortie.

## Ordre de lecture

| Ordre | Document | Objet |
|---|---|---|
| 1 | `00_ETAT_DES_LIEUX_GITHUB.md` | Code existant et écarts constatés |
| 2 | `01_VISION_ET_PARCOURS_CIBLE.md` | Parcours complet cible |
| 3 | `02_SPECIFICATION_COMPTE_PERSONNEL.md` | Inscription, sécurité, profil, résidence |
| 4 | `03_SPECIFICATION_CHOIX_MAGNISA.md` | Créer, rejoindre, finances personnelles |
| 5 | `04_SPECIFICATION_CREATION_ORGANISATION.md` | Wizard, données facultatives, banque, social |
| 6 | `05_ARCHITECTURE_DONNEES_ET_SECURITE.md` | Modèle de données, confidentialité, migrations |
| 7 | `06_PLAN_DE_TESTS_ET_ACCEPTATION.md` | Tests et critères de livraison |
| 8 | `07_DEPLOIEMENT_ET_RETOUR_ARRIERE.md` | Release, surveillance, rollback |
| 9 | `08_BACKLOG_IMPLEMENTATION.md` | Tâches ordonnées et cases à cocher |
| 10 | `DECISIONS_A_VALIDER.md` | Décisions qui nécessitent validation métier |

## Règle d'or

**Auditer → spécifier → implémenter → tester → relire → déployer.**  
Ne jamais reconstruire ce qui existe déjà. Ne jamais modifier les données d'origine d'inscription pour y stocker la résidence actuelle.
