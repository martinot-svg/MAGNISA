# 08 — Backlog d'implémentation ordonné

## État de clôture vérifié — 2026-11-27 (instantané, non clôturant)

Cette section consigne uniquement les preuves consultées pendant la vérification. Elle ne remplace pas les critères d'acceptation des phases et ne transforme pas les éléments non testés en tâches terminées.

## Statut des huit phases fonctionnelles (27-11-2026)

| Phase fonctionnelle | Statut constaté | Preuve / limite |
|---|---|---|
| 1. Identité et username | Validée sur CI | Génération, fallback, unicité, connexion, ID public et origine privée testés sur #411/#412 |
| 2. Inscription personnelle | Partielle | Le parcours en deux étapes existe ; téléphone, date de naissance et résidence distincte absents et soumis aux décisions métier |
| 3. OTP et sécurité e-mail | Partielle | Contrôle de vérification et garde d'invitation testés ; expiration, nombre d'essais et limites runtime réelles non prouvés |
| 4. Choix d'utilisation | Implémenté | Trois choix présents ; finances personnelles désactivées ; suite Vitest passée |
| 5. Wizard organisation | Validée sur CI | Wizard en cinq étapes, contrat SQL et parcours navigateur isolé réussis |
| 6. Informations complémentaires | Non implémentée | Structure bancaire/sociale dédiée, champs facultatifs et permissions spécifiques non réalisés ; décisions d'accès manquantes |
| 7. Paramètres et complétion | Partielle | Read model et accès par rôle testés ; complétion des champs de la phase 6 non réalisée |
| 8. Tests, sécurité et accessibilité | Partielle | CI, rejeu des migrations, RLS multi-tenant et responsive réussis ; revue Advisor exhaustive et audit WCAG 2.2 AA ouverts |

Les phases 0 (audit) et 9 (déploiement) sont des gates transversales, en plus des huit phases fonctionnelles. Elles ne sont pas comptées dans ce tableau.

### Éléments confirmés
- Dépôt : `martinot-svg/MAGNISA`, branche principale `main`, HEAD `main` après fusion de la PR #413 : `832566fd2341849b43bb3574b52f44332ee9d654` (base de #413 : `d374bab33661f4c34ab7a2d2aee1fbc90f8c4b9b`).
- Les PR #411 et #412 sont fusionnées. Les corrections SQL associées préservent les clés étrangères des lignes de factures et corrigent le contrat de rejeu d'index.
- Supabase : 279 migrations dans le registre, dernière version enregistrée `20261130080000`.
- Supabase : les deux clés étrangères de lignes de factures contrôlées sont présentes et validées ; elles utilisent `invoice_lines_id_organization_uidx`.
- Supabase : `invoice_lines_id_org_uidx` est absent de la base inspectée.
- Vercel : le déploiement de production inspecté est `READY`, commit `f631368a51206e7f4ff49610e370bd402a1169eb` (fusion #402). Il est antérieur aux fusions #411 et #412.
- Les journaux de ce déploiement montrent la fin de la compilation Next.js et des suites Vitest réussies dans les extraits disponibles ; le bilan exhaustif de toutes les suites n'a pas été établi.
- Inscription : le schéma serveur actuel exige prénom, nom, e-mail, username, mot de passe et confirmation, mais aussi pays, région et localité pour enregistrer l'origine d'inscription. Il ne collecte pas le téléphone, la date de naissance ni une résidence personnelle distincte.
- Profil : l'inventaire SQL observé de `profiles` ne montre pas de colonnes téléphone, date de naissance ou résidence.
- Onboarding : les trois choix demandés sont présents ; la carte des finances personnelles est désactivée et annoncée « Bientôt disponible ».
- Wizard organisation : cinq étapes présentes, validation Zod partagée, champs NIF/STAT/RCS, adresse organisationnelle et régime fiscal/TVA avec valeur « À confirmer ».
- Données organisationnelles : `company_settings.bank_details` existe déjà en texte. Les politiques RLS observées limitent la table brute aux rôles owner/admin ; le read model applique un masquage par permission. La structure bancaire/sociale dédiée prévue par la phase 6 n'est pas confirmée.
- Contrôles SQL ciblés en lecture seule : quatre assertions réussies pour la vue des paramètres (security_invoker + security_barrier), la fonction de lecture permission-aware (SECURITY DEFINER, search_path fixé, grants), la RLS restrictive de la table brute et la RLS de `profiles`.
- Supabase Security Advisor : 24 tables RLS sans policy (INFO) et 153 fonctions SECURITY DEFINER exécutables par authenticated (WARN). Les 153 ont un `search_path` fixé ; deux fonctions sans contrôle d'identité inline délèguent à des helpers de membership/permission dont les définitions ont été inspectées. La revue exhaustive reste ouverte.
- Supabase Performance Advisor : 266 clés étrangères sans index couvrant et 47 index signalés inutilisés (INFO). Aucun index n'a été modifié automatiquement.

### Points non validés / critères de clôture encore ouverts
- Comparaison exhaustive des migrations locales, staging et production, y compris sauvegarde chiffrée et restauration isolée : preuves complètes non réunies dans cet instantané.
- Parcours OTP réel (expiration, renvoi, rate limit, tentatives et accès avant vérification) : le code six chiffres et le renvoi avec gestion d'erreur de rate limit sont présents ; les scénarios runtime complets n'ont pas été exécutés ici.
- Parcours E2E isolés réussis dans les runs #2847/#2849 : identité, connexion, ID public, origine privée, wizard organisation en cinq étapes, invitations, settings par rôle, isolation de deux tenants et tests responsive. L'ensemble des scénarios OTP de production (expiration, tentatives, délivrabilité et limites exactes) reste à valider.
- Tests RLS multi-rôles et multi-organisations réussis dans les workflows #2847/#2849, dont accès aux paramètres par rôle et isolation de deux tenants. L'audit WCAG 2.2 AA complet n'est pas prouvé.
- Revue exhaustive des 153 fonctions SECURITY DEFINER signalées par Advisor et vérification des grants des 24 tables RLS sans policy : non terminées.
- Revue de performance des 266 clés étrangères non indexées et des 47 index inutilisés : non terminée ; ne pas appliquer de suppression/ajout en masse sans analyse du workload.
- Décisions métier bloquantes dans `DECISIONS_A_VALIDER.md` : âge minimum, règles de résidence, numéro d'immatriculation, validation fiscale et rôles autorisés pour les données bancaires/sociales.
- Téléphone, date de naissance et résidence distincte : absents du schéma d'inscription/profil inspecté ; leur ajout exige les décisions de confidentialité, conservation et âge minimum.
- Étape facultative d'informations complémentaires : son périmètre et ses règles d'accès ne sont pas validés ; aucune donnée bancaire/sociale ne doit être ajoutée sur la base d'hypothèses.
- Aucun staging actuel n'est confirmé : la branche release est 74 commits derrière main et son preview Vercel READY n'est pas un environnement staging à jour. Le dernier déploiement production Vercel observé est READY sur #402 ; les PR #411/#412 ne modifient que migrations/contrats SQL. Aucun smoke test live post-déploiement n'est documenté.

### Règle de mise à jour
Ne cocher une tâche ci-dessous qu'après une preuve technique reproductible et attachée à la livraison. Les statuts partiels, bloqués et non exécutés doivent rester distincts.

## Phase 0 — Audit technique complet et gel du périmètre
- [x] Récupérer le HEAD exact de `main` (preuve : SHA de base de la PR #413, `d374bab33661f4c34ab7a2d2aee1fbc90f8c4b9b`).
- [ ] Inventorier toutes les migrations Supabase, dans l'ordre chronologique.
- [ ] Comparer migrations locales et migrations appliquées en staging/production.
- [x] Inventorier les colonnes de `profiles` et `company_settings` (inspection `information_schema.columns`, 27-11-2026).
- [ ] Rechercher tous les usages de `onboarding_profile`.
- [ ] Cartographier triggers Auth et fonctions de génération username.
- [ ] Cartographier toutes les RPC d'identité et d'origine géographique.
- [ ] Cartographier policies RLS et privilèges sur les tables concernées.
- [ ] Cartographier routes d'onboarding et invitations.
- [ ] Établir les tests existants et leur état.
- [x] Documenter les champs déjà présents pour éviter les doublons (instantané de clôture ci-dessus).
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
