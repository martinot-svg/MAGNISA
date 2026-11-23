# Phase 1 — vérification CI et état GitHub du 23 novembre 2026

Dépôt : `martinot-svg/MAGNISA`
Branche testée : `qa/phase1-closeout-refresh-20261123`
Commit testé : `f7bb5cfc65ec2cd3e1e32c2746cc9b4a5ce48d4b`

## Vérification automatisée terminée

- MAGNISA CI run [#45179969066](https://github.com/martinot-svg/MAGNISA/actions/runs/45179969066) : **success**.
  - `build` : success.
  - `magnibox-local-e2e` : success.
- Supabase migration replay run [#45179968592](https://github.com/martinot-svg/MAGNISA/actions/runs/45179968592) : **success**.
  - Le job `replay` est terminé avec succès.
  - L'étape « Verify five-step company onboarding in an isolated browser » est **success**.
- PR [#356](https://github.com/martinot-svg/MAGNISA/pull/356) : ouverte, non fusionnée, mergeable.
- Recherche GitHub le 23 novembre 2026 : aucune issue ouverte dans le dépôt et aucune autre PR ouverte que #356.

## Ce que le test d'onboarding vérifie

Sur un environnement Supabase local éphémère, avec un compte Auth créé pour le test :
- création via le parcours navigateur mobile en cinq étapes ;
- données de profil et paramètres société persistés ;
- membership du créateur avec rôle `owner` et statut `active` ;
- six séquences documentaires attendues : devis, commande, facture, avoir, paiement et dépense ;
- préfixes, `next_value=1` et `padding=5` ;
- accès final aux paramètres société et absence d'erreur navigateur capturée.

Les données du test sont synthétiques et isolées. Aucun compte ou dossier de production n'a été utilisé.

## Limites explicites

Ces succès démontrent le build, les tests configurés dans les workflows et le chemin de création d'un tenant neuf dans l'environnement local. Ils ne démontrent pas :
- la migration/upgrade d'une base SaaS déjà peuplée et la conservation de toutes ses données ;
- la matrice RBAC exhaustive des huit modules avec tous les rôles et refus d'accès ;
- la réussite de toutes les chaînes métier end-to-end ;
- l'exactitude métier de chaque export PDF/XLSX et les rapprochements comptables ;
- la certification des états financiers PCG, de la paie ou la validation par un professionnel compétent.

## Décision

**La Phase 1 reste NON CLÔTURÉE.** Les workflows verts sont une preuve CI importante, pas un PV final de recette métier ou comptable. Les verrous de readiness et les données comptables ne doivent pas être modifiés pour faire passer la recette.
