# 08 — Backlog d'implémentation ordonné

## Phase 0 — Audit technique complet et gel du périmètre
- [ ] Récupérer le HEAD exact de `main`.
- [ ] Inventorier toutes les migrations Supabase, dans l'ordre chronologique.
- [ ] Comparer migrations locales et migrations appliquées en staging/production.
- [ ] Inventorier toutes les colonnes de `profiles` et `company_settings`.
- [ ] Rechercher tous les usages de `onboarding_profile`.
- [ ] Cartographier triggers Auth et fonctions de génération username.
- [ ] Cartographier toutes les RPC d'identité et d'origine géographique.
- [ ] Cartographier policies RLS et privilèges sur les tables concernées.
- [ ] Cartographier routes d'onboarding et invitations.
- [ ] Établir les tests existants et leur état.
- [ ] Documenter les champs déjà présents pour éviter les doublons.
- [ ] Faire valider les décisions de `DECISIONS_A_VALIDER.md`.

**Sortie attendue :** rapport d'audit complet et modèle de données confirmé. Aucune migration de production à ce stade.

## Phase 1 — Cohérence de l'identité et du username
- [ ] Définir la source de vérité du username.
- [ ] Conserver génération automatique et personnalisation demandée.
- [ ] Implémenter réservation atomique si nécessaire.
- [ ] Aligner validation UI, action serveur et SQL.
- [ ] Vérifier unicité concurrente.
- [ ] Vérifier compatibilité des comptes historiques.
- [ ] Vérifier public ID 14 chiffres et origines privées inchangés.

**Sortie attendue :** un username affiché = un username réellement réservé/persisté.

## Phase 2 — Refonte progressive de l'inscription personnelle
- [ ] Étape 1 identité et coordonnées.
- [ ] Ajouter téléphone si absent après audit.
- [ ] Ajouter date de naissance si absente après audit.
- [ ] Ajouter résidence distincte si absente après audit.
- [ ] Conserver origine d'inscription privée et immuable.
- [ ] Étape 2 mot de passe et confirmation.
- [ ] Aligner politique de mot de passe UI/serveur/Supabase.
- [ ] Préserver les messages d'erreur et la gestion des états.
- [ ] Ajouter tests de validation et non-régression.

**Sortie attendue :** inscription en deux étapes sans régression Auth.

## Phase 3 — Vérification e-mail et sécurité
- [ ] Vérifier configuration Supabase OTP six chiffres.
- [ ] Vérifier expiration, rate limit et nombre d'essais.
- [ ] Garder un seul système de vérification.
- [ ] Tester renvoi et redirection.
- [ ] Bloquer l'accès protégé avant vérification.
- [ ] Vérifier les logs et les métadonnées pour absence de secrets.

**Sortie attendue :** parcours OTP robuste et documenté.

## Phase 4 — Écran de choix d'utilisation
- [ ] Réutiliser `/onboarding`.
- [ ] Renommer la carte de création : « Créer un espace pour mon organisation ».
- [ ] Renommer la carte invitation : « Rejoindre une équipe ».
- [ ] Ajouter « Gérer mes finances personnelles ».
- [ ] Afficher « Bientôt disponible » et désactiver l'action finances personnelles.
- [ ] Vérifier le comportement si l'utilisateur possède déjà plusieurs organisations.
- [ ] Vérifier le parcours invitation existant.

**Sortie attendue :** trois choix cohérents et aucune fonctionnalité fictive.

## Phase 5 — Harmonisation du wizard organisation
- [ ] Garder `CompanyCreationWizard`.
- [ ] Garder `onboarding-schema.ts` comme validation partagée.
- [ ] Garder `company-onboarding.ts` et la RPC existante.
- [ ] Vérifier les champs NIF, STAT, RCS et leur mapping SQL.
- [ ] Vérifier la forme juridique et les statuts.
- [ ] Faire valider les libellés fiscaux.
- [ ] Préserver le logo et le stockage sécurisé.
- [ ] Préserver l'adresse d'organisation séparée de la résidence.

**Sortie attendue :** wizard existant harmonisé, pas reconstruit.

## Phase 6 — Nouvelle étape facultative « Informations complémentaires »
- [ ] Confirmer son emplacement exact.
- [ ] Ajouter numéro d'immatriculation et date si absents.
- [ ] Réutiliser NIF/RCS/STAT déjà existants.
- [ ] Ajouter effectif.
- [ ] Ajouter banque et titulaire.
- [ ] Ajouter numéro de compte et RIB.
- [ ] Ajouter affiliations CNAPS/OSTIE/autre et références.
- [ ] Ne demander aucun document juridique.
- [ ] Ajouter « Ignorer cette étape ».
- [ ] Ajouter « Enregistrer et continuer ».
- [ ] Stocker les informations bancaires dans une structure dédiée.
- [ ] Définir permissions dédiées aux données bancaires/sociales.
- [ ] Prévoir modification ultérieure dans les paramètres.
- [ ] Tester les cas vides, partiels, invalides et autorisés/refusés.

**Sortie attendue :** étape entièrement facultative, sans fuite de données sensibles.

## Phase 7 — Paramètres et complétion après création
- [ ] Permettre la modification des informations organisationnelles.
- [ ] Permettre de compléter les informations manquantes.
- [ ] Protéger les informations bancaires/sociales.
- [ ] Afficher l'état de complétion sans bloquer les opérations.
- [ ] Préserver l'historique nécessaire.
- [ ] Vérifier les droits par rôle.

**Sortie attendue :** chaque champ facultatif peut être complété après création.

## Phase 8 — Tests, sécurité et accessibilité
- [ ] Exécuter la matrice de tests complète.
- [ ] Exécuter les tests RLS multi-rôles et multi-organisations.
- [ ] Vérifier les parcours mobile/tablette/desktop.
- [ ] Vérifier WCAG 2.2 AA.
- [ ] Vérifier absence de fuite de données personnelles/sensibles.
- [ ] Exécuter les tests de non-régression Auth, organisations, invitations, paie et comptabilité.
- [ ] Faire revue de code et revue migration.

**Sortie attendue :** toutes les gates de `06_PLAN_DE_TESTS_ET_ACCEPTATION.md` sont vertes.

## Phase 9 — Déploiement progressif
- [ ] Déployer les migrations additives en staging.
- [ ] Déployer le code en staging.
- [ ] Tester les anciens et nouveaux comptes.
- [ ] Valider création d'organisation et invitation.
- [ ] Activer progressivement en production.
- [ ] Surveiller les métriques expurgées.
- [ ] Documenter les résultats et le commit final.

**Sortie attendue :** release validée et plan de retour arrière disponible.
