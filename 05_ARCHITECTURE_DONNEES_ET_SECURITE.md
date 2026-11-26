# 05 — Architecture des données, sécurité et migrations

## 1. Principes d'architecture

- Supabase Auth est la source de vérité de l'authentification.
- `public.profiles` contient uniquement les données de profil qui doivent être disponibles selon ses policies.
- Les données d'origine d'inscription restent dans le schéma privé existant.
- Les données de résidence sont séparées et modifiables.
- Les données d'organisation sont liées à l'organisation, pas au compte personnel.
- Les informations bancaires/sociales sensibles ne sont pas mélangées au JSON d'onboarding général.
- Les contrôles critiques sont exécutés côté serveur et/ou en base.
- RLS doit être activé sur toute nouvelle table exposée par l'API Supabase.

## 2. Audit préalable obligatoire

Avant d'écrire une migration, rechercher dans tout le dépôt et le schéma déployé :
- `profiles` et toutes ses colonnes ;
- `auth.users` triggers ;
- `sync_auth_profile()` ;
- `magnisa_issue_profile_id()` et ses versions ;
- toutes les fonctions de génération/claim de username ;
- `register_magnisa_signup_location()` et les anciennes RPC de localisation ;
- `private.magnisa_identity_mapping` ;
- `private.magnisa_declared_origin` ;
- toutes les tables et vues qui lisent `company_settings` ;
- RLS policies de `company_settings`, `organization_members`, `storage.objects` ;
- `magnisa_create_onboarded_company()` et `create_organization()` ;
- fonctions d'invitation et d'adhésion ;
- usages de `onboarding_profile` dans l'application ;
- toutes les migrations postérieures aux migrations ciblées dans l'audit initial.

Ne pas supposer que l'état local des migrations correspond exactement à la production.

## 3. Modèle logique recommandé

### Profil personnel
Champs à vérifier puis ajouter uniquement s'ils n'existent pas déjà :
- `phone_e164` (téléphone normalisé).
- `date_of_birth` (date).
- `residence_country_code`.
- `residence_region_code`.
- `residence_locality_name` ou identifiant de localité référencé.
- `residence_locality_ref` si un référentiel stable existe.

Ne pas enregistrer les valeurs de résidence dans la table privée d'origine. Ne pas réutiliser les colonnes de l'origine.

### État d'inscription
Le suivi d'étapes peut utiliser une table dédiée ou une colonne existante après vérification :
- étape courante ;
- état de vérification e-mail ;
- étape de profil complétée ;
- date de dernière modification.

Ne pas dupliquer `email_confirmed_at` de Supabase Auth comme source d'autorité sans raison. Un champ dérivé doit rester synchronisé.

### Organisation
Réutiliser :
- `company_settings.legal_name`
- `trade_name`
- `slogan`
- `activity_sector`
- `address`
- `phone`
- `email`
- `tax_id`
- `stat_id`
- `registry_id`
- `income_tax_regime`
- `vat_status`
- `onboarding_profile`
- chemins de logo existants.

Ajouter seulement les attributs absents et après recherche globale des usages.

### Données bancaires
Modèle conceptuel, pas une migration prête à exécuter :
- identifiant ;
- organisation ;
- nom de banque ;
- titulaire ;
- numéro de compte protégé ;
- RIB protégé ;
- statut actif/inactif ;
- créé/modifié par ;
- horodatage.

Accès séparé, lecture et modification explicitement autorisées.

### Affiliations sociales
Modèle conceptuel :
- identifiant ;
- organisation ;
- organisme (`CNAPS`, `OSTIE`, `OTHER`) ;
- libellé si `OTHER` ;
- numéro d'affiliation ;
- dates et auteur de modification.

## 4. RLS et permissions

Pour chaque nouvelle table :
- activer RLS ;
- révoquer les privilèges anon ;
- n'accorder que les opérations nécessaires ;
- créer des policies basées sur l'adhésion active et le rôle ;
- tester accès anonyme, membre simple, manager, admin, owner et utilisateur d'une autre organisation ;
- interdire l'accès inter-organisation ;
- vérifier les fonctions `SECURITY DEFINER` et leur `search_path` ;
- révoquer `EXECUTE` de `public`/`anon` lorsque requis ;
- ne jamais donner de droit implicite à un administrateur d'une autre organisation.

Les rôles autorisés à voir les informations bancaires et sociales doivent être définis explicitement. Ne pas déduire que tout `admin` ou `owner` a automatiquement besoin de ces données.

## 5. Migration et intégrité

- Migrations forward-only.
- Pas de `DROP TABLE`, `DROP COLUMN`, `DROP FUNCTION`, suppression de trigger ou policy sans analyse des dépendances et plan de compatibilité.
- Ajouter les colonnes avec compatibilité ascendante.
- Backfill uniquement à partir de données fiables ; ne jamais inventer date de naissance, téléphone ou résidence.
- Conserver les anciens comptes avec champs nouveaux nullables jusqu'à leur mise à jour.
- Ajouter contraintes et `NOT NULL` seulement après mesure de couverture et validation.
- Index uniquement selon les requêtes et règles d'unicité réellement nécessaires.
- Déployer d'abord les migrations compatibles, puis le code, puis activer les fonctionnalités.

## 6. Incohérence username à résoudre

L'action serveur accepte un nom d'utilisateur et vérifie une collision. La migration de génération automatique indique que le trigger ignore la valeur fournie en metadata. Le correctif doit choisir un flux atomique unique :
- soit génération serveur obligatoire et UI d'édition retirée ;
- soit réservation/claim atomique du username personnalisé par RPC sécurisée ;
- soit génération d'une suggestion puis réservation transactionnelle au moment de la création.

La préférence fonctionnelle du projet est que l'utilisateur puisse modifier la suggestion. Le choix recommandé est une RPC de réservation/claim atomique, avec validation stricte et unicité DB. Ne pas accepter une valeur libre via `raw_user_meta_data`.

## 7. Données sensibles

- Pas de données bancaires dans les logs.
- Pas de numéro de compte complet dans les notifications.
- Masquage par défaut.
- Pas d'analytics avec e-mail, téléphone, date de naissance, RIB, numéro de compte ou numéro social.
- Contrôle de permission serveur pour chaque lecture et écriture.
- Journal d'audit sans valeur secrète, seulement l'acteur, l'action, l'objet et l'horodatage.
- Politique de conservation et de suppression à valider avec les obligations applicables.

## 8. Sauvegarde et migration

Avant chaque migration :
1. confirmer la branche et le commit de base ;
2. vérifier les migrations déjà appliquées ;
3. sauvegarder la base selon la procédure projet ;
4. exécuter sur environnement de test ;
5. comparer le schéma avant/après ;
6. vérifier les fonctions/triggers/policies ;
7. tester les flux d'inscription et de création d'organisation ;
8. consigner la version et le résultat.
