# Avancement et clôture des chantiers MAGNISA

État de référence : 25 novembre 2026. Les PR #372, #373, #374 et #375 sont fusionnés dans `main`. La fusion confirme l'intégration des changements, pas la clôture fonctionnelle complète de chaque lot.

## Livraisons intégrées et contrôles récents

- PR #372 — catalogue de services et réservations : https://github.com/martinot-svg/MAGNISA/pull/372
- PR #373 — compléments CRM, automatisation, analytics et sécurité : https://github.com/martinot-svg/MAGNISA/pull/373
- PR #374 — finalisation analytics et soldes échus : https://github.com/martinot-svg/MAGNISA/pull/374
- PR #375 — allowlist des deux migrations service/réservation : https://github.com/martinot-svg/MAGNISA/pull/375
- CI du correctif #375 et replay Supabase sur sa branche : réussis.
- Précontrôle de production après fusion #375 : réussi en lecture seule. L'étape d'application des migrations a été ignorée; aucune application de ces migrations en production n'est confirmée par ce run.
- Les workflows CI, migration replay, E2E Mailpit et sauvegarde vérifiée déclenchés sur `main` étaient encore en cours au moment de cette mise à jour. Leur succès final doit être constaté séparément.

## État par chantier

| Chantier | État actuel | Critères de clôture encore nécessaires |
|---|---|---|
| 1. Catalogue et tarifs | Intégré; unités contrôlées, catégories et historique tarifaire disponibles | Recette CRUD complète, prix figés dans les documents historiques, contrôle tenant/RLS, migration replay sur base restaurée |
| 2. Réservations | Intégré; ressources, créneaux et prévention des chevauchements présents | Tests de concurrence réelle, annulation/modification, règles de fuseau horaire, RLS multi-tenant et E2E |
| 3. CRM | Améliorations intégrées; parcours CRM existants étendus | Contacts multiples, détection doublons, historique unifié et KPI vérifiés sur plusieurs organisations |
| 4. Automatisation | Modèle d'idempotence et de reprise renforcé | Persistance atomique des jobs, worker/claim concurrent, retries durables, dead-letter observable et preuve E2E des effets externes |
| 5. Analytics | KPI de solde échu branché; comparaison de périodes disponible en fonction | Agrégats serveur supplémentaires, réconciliation avec les états comptables, validation devise/période et exports |
| 6. Portail client / signature / paiement | Préparation HMAC seulement; aucune intégration fournisseur considérée opérationnelle | Décision fournisseur, identité et consentement client, webhooks spécifiques, idempotence persistée, rapprochement, remboursements et tests |
| 7. Assistant IA | Non démarré | Spécification et garde-fous; lecture seule sur données agrégées, provenance et période, tests d'autorisation et anti-fuite |

## Ordre de clôture

1. Attendre et consigner les résultats finaux des workflows `main` en cours.
2. Rejouer et vérifier les migrations sur une base isolée restaurée; ne pas toucher aux données historiques de production.
3. Terminer les tests de concurrence et multi-tenant des chantiers 1–3.
4. Implémenter le worker durable et l'observabilité du chantier 4.
5. Compléter les agrégats et leur réconciliation du chantier 5.
6. Décider si le chantier 6 doit être livré maintenant ou reste bloqué par le choix d'un fournisseur.
7. Maintenir le chantier 7 non démarré tant que son périmètre et ses contrôles ne sont pas approuvés.

## Règles de clôture

Un chantier ne sera marqué **terminé** qu'avec preuves CI, tests fonctionnels, RLS multi-tenant, migration replay, E2E et revue de sécurité. Une PR fusionnée ou une page visible ne suffit pas.

Aucun déploiement ni application de migration en production ne doit être déduit de la fusion des PR. Les données financières historiques restent intangibles; toute correction passe par les mécanismes d'annulation ou de contrepassation prévus.
