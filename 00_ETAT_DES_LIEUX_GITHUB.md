# 00 — État des lieux du dépôt GitHub

## 1. Périmètre audité

Dépôt `martinot-svg/MAGNISA`, branche `main`.

Fichiers consultés lors de la préparation de ce dossier :

### Compte personnel et authentification
- `src/app/signup/page.tsx`
- `src/app/verify-email/page.tsx`
- `src/server/actions/auth.ts`
- `src/lib/auth/magnisa-identity.ts`
- `src/app/onboarding/page.tsx`

### Création d'organisation
- `src/components/company-creation-wizard.tsx`
- `src/lib/company/onboarding-schema.ts`
- `src/server/actions/company-onboarding.ts`
- `supabase/migrations/20261113184000_create_company_onboarding.sql`
- `src/lib/company/company-sectors.ts` (référencé par le schéma et le wizard)

### Identité et confidentialité
- `supabase/migrations/20261009092020_0012_auth_profiles_and_security.sql`
- `supabase/migrations/20261113093348_private_magnisa_user_identity.sql`
- `supabase/migrations/20261113125253_automatic_short_usernames.sql`
- `supabase/migrations/20261113173600_signup_region_locality.sql`
- `supabase/migrations/20261009091913_0008_email_verification.sql`

**Limite de l'audit :** cette lecture ciblée ne constitue pas encore un inventaire exhaustif de toutes les migrations, colonnes, triggers, fonctions RPC, policies, appels applicatifs et usages des données. La phase 0 doit terminer cet inventaire avant toute migration.

## 2. Mécanismes déjà présents à préserver

### Identité personnelle
- Compte personnel Supabase Auth.
- Table `public.profiles` synchronisée depuis `auth.users`.
- Identifiant public opaque de 14 chiffres.
- Nom d'utilisateur généré côté base de données avec allocation atomique.
- Index unique du nom d'utilisateur.
- Compatibilité des anciens noms d'utilisateur.
- Limitation de changement du nom d'utilisateur par une période de 30 jours dans la fonction d'identité.
- Rate limiting pour les tentatives de connexion par nom d'utilisateur.

### Confidentialité du lieu d'inscription
- Schéma `private` et tables privées d'identité/origine.
- L'origine géographique n'est pas envoyée dans `raw_user_meta_data`.
- RPC de service pour enregistrer l'origine.
- Région et localité déclarées conservées séparément.
- RLS et révocation des accès anon/authenticated sur les tables privées.
- Le lieu d'inscription est conçu comme une donnée confidentielle et immuable.

### Vérification e-mail
- Route `/verify-email`.
- Code de vérification à six chiffres via Supabase Auth `verifyOtp`.
- Renvoi du code via `resend`.
- Temporisation UI de 60 secondes.
- Redirection vers `/onboarding` après vérification réussie.

### Création d'organisation
- Wizard client `CompanyCreationWizard`.
- Validation Zod centralisée.
- Action serveur `createCompanyFromForm`.
- RPC SQL `magnisa_create_onboarded_company`.
- Fonction existante `create_organization()`.
- Association du créateur à l'organisation et rôle initial géré par la fonction de création existante.
- Enregistrement des paramètres dans `company_settings`.
- Stockage privé des logos dans `organization-branding`.
- Palette documentaire dérivée du logo.
- Référentiel de secteurs et d'activités.
- Données fiscales marquées comme déclaratives/non confirmées.

## 3. Écarts constatés

| Domaine | État actuel | Cible souhaitée | Travail |
|---|---|---|---|
| Inscription | Prénom, nom, nom d'utilisateur, e-mail, mot de passe et confirmation dans le même formulaire | Étape identité puis étape sécurité séparée | Réorganiser sans casser Auth |
| Téléphone personnel | Non visible dans le formulaire d'inscription audité | Obligatoire dans le compte personnel | Auditer le schéma et ajouter seulement si absent |
| Date de naissance | Non visible dans le formulaire audité | Obligatoire | Décision âge minimum et politique de conservation |
| Résidence | Formulaire actuel demande région/localité d'inscription | Ajouter région et ville de résidence distinctes | Ne jamais écraser l'origine d'inscription |
| Nom utilisateur | UI/action acceptent une saisie, mais migration DB récente documente une génération serveur qui ignore le username fourni en metadata | Comportement cohérent : suggestion modifiable et réservation réelle côté serveur/DB | Corriger l'écart UI/DB après vérification de l'ordre réel des migrations |
| Choix d'utilisation | `/onboarding` affiche créer, rejoindre, espace personnel | Présenter clairement trois choix : organisation, finances personnelles bientôt, rejoindre une équipe | Réutiliser la route et les composants existants |
| Création d'organisation | Wizard de cinq étapes | Préserver le wizard, ajouter une étape complémentaire facultative | Extension contrôlée |
| Informations complémentaires | NIF, STAT, RCS, régime fiscal, logo déjà présents à divers endroits | Éviter les doublons et réutiliser les champs | Harmonisation du modèle |
| Banque | Pas visible dans le schéma d'onboarding audité | Banque, titulaire, compte, RIB facultatifs | Stockage hautement restreint, hors JSON général |
| Social | Pas visible dans le schéma audité | CNAPS, OSTIE, autre et numéros facultatifs | Stockage structuré, accès restreint |
| Effectif | Pas visible dans le schéma audité | Nombre d'employés facultatif | Ajouter au modèle d'onboarding |
| Régime fiscal | UI actuelle affiche `IS — Impôt synthétique` et `IR — Impôt sur les revenus` | Libellés exacts validés juridiquement | Bloquer le changement de libellé jusqu'à validation métier/juridique |

## 4. Point critique : nom d'utilisateur

Deux intentions sont actuellement en tension :
1. Le formulaire permet à l'utilisateur de modifier le nom d'utilisateur suggéré.
2. La migration `20261113125253_automatic_short_usernames.sql` indique que le trigger DB ignore le nom d'utilisateur fourni dans les métadonnées Auth et génère lui-même un nom à partir des prénoms/noms.

En conséquence, la disponibilité pré-vérifiée dans l'action serveur ne garantit pas que le nom affiché sera celui effectivement créé.

**Décision technique obligatoire en phase 1 :** définir une seule source de vérité. Recommandation : le serveur/DB doit allouer le nom de façon atomique et permettre une demande explicite de nom personnalisé via une RPC/transaction sécurisée, sans se fier aux métadonnées client. Le formulaire doit afficher clairement le résultat réellement réservé.

## 5. Règles de non-régression

- Ne pas changer le format de l'identifiant public 14 chiffres.
- Ne pas déplacer les données d'origine privée vers `profiles`, Auth metadata, JWT ou analytics.
- Ne pas transformer la résidence en origine d'inscription.
- Ne pas casser les utilisateurs déjà inscrits.
- Ne pas réinitialiser les noms d'utilisateur historiques.
- Ne pas supprimer le wizard existant.
- Ne pas remplacer `create_organization()` par une nouvelle implémentation sans preuve de nécessité.
- Ne pas toucher aux modules paie, comptabilité, stocks, facturation ou permissions qui ne sont pas dans le périmètre.
