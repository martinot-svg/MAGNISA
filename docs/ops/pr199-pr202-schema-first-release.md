# MAGNISA — PR #199/#202 : livraison préalable du schéma (14 novembre 2026)

## Périmètre exact

Cette branche ne contient **aucun changement d'interface**. Elle prépare le schéma
nécessaire aux futures PR #199 (inscription et localités) et #202
(création d'entreprise en cinq étapes, deux logos).

Migrations copiées **sans modification** des branches validées :
1. `20261113173600_signup_region_locality.sql` : régions, origine géographique
   déclarée, fonctions d'inscription et de reprise du profil.
2. `20261113184000_create_company_onboarding.sql` : profil de création
   d'entreprise, logo inverse et paramètres visuels, RPC transactionnelle.

Elles sont inscrites explicitement dans la liste des versions autorisées
`production-pending-allowlist.txt`. Cela n'implique **aucune exécution** sur
Supabase : le workflow de production exige encore un déclenchement manuel
`APPLY` et une sauvegarde chiffrée restaurée et vérifiée.

## Relevé de production (lecture seule)

Projet `pmlzirobpdlzsrvtkvir`, le 14 novembre 2026 :

- 212 versions de migration, tête : `20261113125253`
  (`automatic_short_usernames`).
- `20261113093348` est déjà appliquée.
- `20261113173600` et `20261113184000` ne sont pas appliquées.
- `private.magnisa_declared_origin` et les deux nouvelles RPC sont absentes.
- `organization-branding` est privé, plafond encore à 5 MiB.
- Tous les fichiers locaux versionnés sur `main` correspondent à la version
  et au nom du journal distant à une exception : `20261031123421` est
  une migration explicitement « local replay-only », et la version distante
  `20261113125253` n'a pas de fichier versionné dans `main`.

## Récupération contrôlée de l'historique

La version distante `20261113125253` a été récupérée **en lecture seule**
depuis `supabase_migrations.schema_migrations.statements[1]`, et copiée dans
`supabase/migrations/archive_20261113125253_automatic_short_usernames.sql`.

- Nom distant : `automatic_short_usernames`.
- Longueur du SQL original : 7 856 caractères.
- SHA-256 du SQL stocké en production :
  `6b4b36744793d0d5ea5fa6e3a9f7663bb82caa7a297affdee2e92f8b99559643`.
- Le manifeste `production-history-reconciliation.tsv` référence cette
  récupération avec type `recovered` et digest exact.
- Le préfixe `archive_` évite de rejouer cette migration en CI ou en
  production sous une nouvelle version. Il ne s'agit **pas** d'une demande
  pour réexécuter le SQL existant.

Le garde-fou `check-production-migration-history.sh` doit vérifier la
correspondance des noms et du digest avant toute livraison.

## Effets, risques et retour arrière

La première migration ajoute une table `private` protégée, 24 valeurs de
référence et deux fonctions dont les permissions sont limitées.

La seconde ajoute deux colonnes, des métadonnées de création d'entreprise,
une fonction d'insertion contrôlée par l'identité de l'utilisateur, et
remplace les politiques d'envoi de logos pour réserver l'écriture aux
propriétaires/administrateurs. Elle augmente le plafond **technique** de
l'espace `organization-branding` à 50 MiB, dans les limites du forfait.

Il s'agit d'une modification de structure rétrocompatible avec l'ancienne
interface, **mais pas d'un script à annuler automatiquement** : les règles
Storage changent. En cas de problème, privilégier le retour arrière de
l'interface ou un correctif SQL revu. Une restauration de base chiffrée
vérifiée est indispensable avant toute application.

## Séquence de déploiement

1. Faire réussir la CI et le replay Supabase de cette PR **schéma uniquement**.
2. Fusionner la PR de schéma seulement après revue et contrôle des versions
   réelles : les automatisations de push sur `main` ne doivent appliquer
   aucun SQL, seulement sauvegarder et exécuter les préflights.
3. Confirmer l'existence d'une sauvegarde **chiffrée, restaurée et vérifiée**
   pour le SHA exact de `main`, ainsi que le préflight de migration réussi.
4. Lancer manuellement `Deploy Supabase production migrations` avec
   `confirm_production=APPLY` (et aucun `db push --include-all`).
5. Vérifier, en lecture seule, les deux versions dans le journal,
   la table `private`, les droits des RPC et le bucket privé.
6. Fusionner **#199**, puis repositionner **#202** sur `main` et fusionner
   seulement après leurs checks requis. Contrôler Vercel, les comptes
   existants et la recette sur des données fictives sans toucher aux
   données commerciales.
7. Ne clore l'issue #209 qu'après preuves GitHub, Supabase et Vercel.

**Le contenu de ce fichier décrit le protocole ; les étapes 2 à 7 ne sont
pas réputées exécutées à la création de cette branche.**
