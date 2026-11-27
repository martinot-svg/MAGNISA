# Historique du dossier

## 1.3 — 2026-11-27 — Validation CI et statut de livraison
- PR #413 fusionnée dans `main` : commit `832566fd2341849b43bb3574b52f44332ee9d654`. Elle contient l'instantané de clôture et les constats SQL/Advisor.
- PR #401 : `MAGNISA CI` et `Supabase migration replay` réussis (runs #4739 et #2788). Elle corrige le contexte JWT de l'assertion owner et le test de snapshot vide après l'échec historique du run #2782 sur PR #400.
- PR #402 : `MAGNISA CI`, `Supabase migration replay` et `MAGNIBOX local Postfix to Mailpit E2E` réussis (runs #4783, #2807 et #389). Déploiement Vercel de production READY sur le merge commit `f631368a51206e7f4ff49610e370bd402a1169eb`.
- PR #411 : les trois workflows `MAGNISA CI`, `Supabase migration replay` et `MAGNIBOX local Postfix to Mailpit E2E` sont réussis (runs #4908, #2849 et #427). Le rejeu complet depuis une base PostgreSQL 17 vierge, les contrats SQL, les parcours navigateur d'identité et de wizard entreprise, les tests multi-tenant et les tests responsive 13 tailles sont réussis.
- PR #412 : les trois workflows correspondants sont réussis (runs #4902, #2847 et #425). Le rejeu complet des migrations et les contrats d'index/FK sont réussis.
- La CI #411/#412 confirme aussi les tests d'acceptation/refus d'invitations, le read model des paramètres par rôle, le test RLS de deux tenants, les scripts de préservation de tenant et le contrôle responsive.
- PR #414 ouverte : resserre le test d'intégration du nouveau username à 3–10 lettres. Sur son commit `ab227e8a23a8b29b5fe19a5c28651b7b77904d9b`, `MAGNISA CI` et `MAGNIBOX local E2E` sont réussis ; `Supabase migration replay` est encore en cours au dernier contrôle (81 étapes réussies, aucune en échec).
- La branche `release/magnisa-8-phase-finalization` est derrière `main` de 74 commits, sans commit en avance. Son déploiement Vercel READY `ff5f59ec33bfe1237dab0cbcc7b3c528c1644636` est un preview ancien (`target=null`), pas un staging actuel.
- Aucun déploiement Vercel de production postérieur à #402 n'a été trouvé. Les PR #411/#412 modifient les migrations et contrats SQL, pas le code applicatif ; PR #413 est documentaire et #414 est un test. Le déploiement applicatif #402 reste donc le dernier déploiement de code observé, mais aucun smoke test live post-déploiement n'a été exécuté dans cette session.
- Le workflow #2782 en échec sur PR #400 est historique et son défaut de contexte JWT a été corrigé par #401 ; les rejeux complets #2847 et #2849 passent.

## 1.2 — 2026-11-27 — Inspection applicative complémentaire
- HEAD de `main` observé à l'ouverture de la PR documentaire #413 : `d374bab33661f4c34ab7a2d2aee1fbc90f8c4b9b`.
- Inspection du code d'inscription : `signUp` vérifie les noms, l'e-mail, le username, le mot de passe et sa confirmation ; il requiert aussi `country_code`, `region_code` et `locality_name` pour l'origine d'inscription. Le téléphone, la date de naissance et une résidence distincte ne sont pas collectés dans ce schéma.
- Inspection du schéma `profiles` : les colonnes observées comprennent `full_name`, `username`, `public_id`, l'e-mail et les métadonnées de compte ; aucune colonne téléphone, date de naissance ou résidence n'a été observée.
- Inspection de `/onboarding` : les trois choix sont présents, dont les finances personnelles désactivées « Bientôt disponible ». Le test source-based correspondant est couvert par la suite Vitest, réussie sur la PR #414.
- Inspection du wizard organisation : `CompanyCreationWizard` comporte cinq étapes et utilise `onboarding-schema.ts`. Les informations d'immatriculation NIF/STAT/RCS, la situation fiscale à confirmer et l'adresse de l'organisation sont déjà prises en charge dans le parcours existant.
- Inspection du schéma `company_settings` : le champ historique `bank_details` existe en texte ; aucune structure dédiée aux coordonnées bancaires et affiliations sociales n'a été établie par cette inspection. Les politiques SQL observées restreignent la table brute aux rôles owner/admin ; le read model applique un masquage par permission.
- Contrôles SQL ciblés en lecture seule : quatre assertions réussies pour la vue des paramètres (security_invoker + security_barrier), la fonction de lecture permission-aware (SECURITY DEFINER, search_path fixé, grants), la RLS restrictive de la table brute et la RLS de `profiles`.
- Supabase Security Advisor : 24 tables RLS sans policy (INFO) et 153 fonctions SECURITY DEFINER exécutables par authenticated (WARN). Les 153 fonctions ont un search_path fixé ; deux sans contrôle d'identité inline délèguent aux helpers `assert_org_access`/`assert_org_permission` ou `magnibox_*`, dont les définitions consultées contrôlent l'appartenance et les permissions. Revue exhaustive des 153 fonctions et des grants des 24 tables non terminée ; aucune révocation massive n'a été appliquée.
- Supabase Performance Advisor : 266 clés étrangères sans index couvrant et 47 index inutilisés (INFO). Aucun index n'a été supprimé ni ajouté sans analyse d'usage.
- Ces constats confirment que les phases 2 et 6 ne peuvent pas être déclarées achevées. Les décisions de conservation des données personnelles et d'autorisation d'accès restent à résoudre avant ajout de nouveaux champs sensibles.

## 1.1 — 2026-11-27 — Vérification de clôture technique
- Inspection des ressources connectées : dépôt GitHub `martinot-svg/MAGNISA`, projet Supabase `pmlzirobpdlzsrvtkvir` et projet Vercel `magnisa`.
- Confirmations GitHub : les PR #411 et #412 sont fusionnées. Elles corrigent la conservation des index uniques supportant les clés étrangères des lignes de factures et la couverture du contrat de rejeu.
- Vérification Supabase en lecture seule : 279 migrations enregistrées, dernière version `20261130080000`.
- Vérification SQL en lecture seule : les deux clés étrangères `credit_note_lines_invoice_line_org_fkey` et `stock_return_lines_source_invoice_line_id_organization_id_fkey` existent, sont validées et s'appuient sur `invoice_lines_id_organization_uidx`. L'index historique `invoice_lines_id_org_uidx` n'existe plus dans la base inspectée.
- Vérification Vercel : déploiement de production `READY`, commit `f631368a51206e7f4ff49610e370bd402a1169eb`, issu de la fusion #402. Ce déploiement précède les fusions #411 et #412 ; il ne constitue donc pas une preuve de déploiement du dernier HEAD après ces corrections.
- Les journaux du déploiement montrent une compilation Next.js achevée et plusieurs suites de tests Vitest réussies. Le résumé global des tests, la validation E2E complète et le résultat des workflows CI sur le HEAD postérieur aux PR #411/#412 ne sont pas établis par cette inspection.
- Les décisions métier bloquantes du document `DECISIONS_A_VALIDER.md` restent non résolues : âge minimum, référentiel de résidence, immatriculation, régime fiscal et autorisations d'accès aux données bancaires/sociales.
- Aucun déploiement de production ni aucune migration supplémentaire n'a été déclenché pendant cette vérification.
- Les phases restent ouvertes tant que leurs critères d'acceptation et leurs preuves ne sont pas réunis.

## 1.0 — 2026-11-26
- Création du dossier maître de mise à jour.
- Audit ciblé des fichiers d'inscription, d'identité, d'OTP, d'onboarding et de création d'organisation.
- Définition du parcours personnel en quatre phases.
- Définition de l'extension du wizard organisation avec étape facultative.
- Formalisation des règles de sécurité, migrations, tests et déploiement.
- Aucun code applicatif ni migration SQL modifié dans ce paquet.
