# Historique du dossier

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
