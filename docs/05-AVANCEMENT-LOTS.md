# Avancement et clôture des chantiers MAGNISA

État de référence : 25 novembre 2026. Les PR #372, #373, #374, #375, #377 et #378 sont fusionnées dans `main`. La fusion confirme l'intégration des changements, pas la clôture fonctionnelle complète de chaque lot.

## Livraisons intégrées et contrôles récents

- PR #372 — catalogue de services et réservations : https://github.com/martinot-svg/MAGNISA/pull/372
- PR #373 — compléments CRM, automatisation, analytics et sécurité : https://github.com/martinot-svg/MAGNISA/pull/373
- PR #374 — finalisation analytics et soldes échus : https://github.com/martinot-svg/MAGNISA/pull/374
- PR #375 — allowlist des deux migrations service/réservation : https://github.com/martinot-svg/MAGNISA/pull/375
- PR #377 — correction du smoke test CRM FormDialog : https://github.com/martinot-svg/MAGNISA/pull/377
- PR #378 — tests de déduplication e-mail/téléphone et idempotence prospect-client : https://github.com/martinot-svg/MAGNISA/pull/378
- CI de la PR #378 : réussie (build et E2E Magnibox local).
- Sur le commit main `cf837668ed024ebf4720566b59e3feb66fef9157`, les checks `build`, `magnibox-local-e2e` et `replay` sont tous réussis.
- Le replay de migrations est réussi sur l'environnement CI isolé. Cela ne prouve pas que les migrations ont été appliquées en production.
- Le précontrôle de production après fusion #375 a réussi en lecture seule; l'étape d'application des migrations a été ignorée. Aucune application de ces migrations en production n'est confirmée par ce run.
- Vérification GitHub du 25 novembre : aucune PR ouverte et aucune issue ouverte au moment du contrôle.

## État par chantier

| Chantier | État actuel | Critères de clôture encore nécessaires |
|---|---|---|
| 1. Catalogue et tarifs | Intégré; unités contrôlées, catégories et historique tarifaire disponibles | Recette CRUD complète, prix figés dans les documents historiques, contrôle tenant/RLS, migration replay sur base restaurée |
| 2. Réservations | Intégré; ressources, créneaux et prévention des chevauchements présents | Tests de concurrence réelle, annulation/modification, règles de fuseau horaire, RLS multi-tenant et E2E |
| 3. CRM | Améliorations intégrées; tests de conversion, déduplication et idempotence ajoutés | Contacts multiples, historique unifié et KPI vérifiés sur plusieurs organisations |
| 4. Automatisation | Modèle d'idempotence et de reprise renforcé | Persistance atomique des jobs, worker/claim concurrent, retries durables, dead-letter observable et preuve E2E des effets externes |
| 5. Analytics | KPI de solde échu branché; comparaison de périodes disponible en fonction | Agrégats serveur supplémentaires, réconciliation avec les états comptables, validation devise/période et exports |
| 6. Portail client / signature / paiement | Préparation HMAC seulement; aucune intégration fournisseur considérée opérationnelle | Décision fournisseur, identité et consentement client, webhooks spécifiques, idempotence persistée, rapprochement, remboursements et tests |

## Ordre de clôture

1. Terminer les tests de concurrence et multi-tenant des chantiers 1–3.
2. Implémenter le worker durable et l'observabilité du chantier 4.
3. Compléter les agrégats et leur réconciliation du chantier 5.
4. Décider si le chantier 6 doit être livré maintenant ou reste bloqué par le choix d'un fournisseur.
5. Définir le chantier IA séparément, après validation de son périmètre et de ses contrôles.

## Règles de clôture

Un chantier ne sera marqué **terminé** qu'avec preuves CI, tests fonctionnels, RLS multi-tenant, migration replay, E2E et revue de sécurité. Une PR fusionnée ou une page visible ne suffit pas.

Aucun déploiement ni application de migration en production ne doit être déduit de la fusion des PR. Les données financières historiques restent intangibles; toute correction passe par les mécanismes d'annulation ou de contrepassation prévus.
