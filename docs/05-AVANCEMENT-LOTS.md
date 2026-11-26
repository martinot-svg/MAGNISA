# Avancement et clôture des chantiers MAGNISA

État de référence : 26 novembre 2026. Les PR #372–#385 citées ci-dessous sont intégrées dans `main`, y compris #382 (dates strictes), #383 (garde-fous numériques), #384 (suivi) et #385 (queue durable). La fusion confirme l'intégration des changements, pas la clôture fonctionnelle complète de chaque lot.

## Livraisons intégrées et contrôles récents

- PR #372 — catalogue de services et réservations : https://github.com/martinot-svg/MAGNISA/pull/372
- PR #373 — compléments CRM, automatisation, analytics et sécurité : https://github.com/martinot-svg/MAGNISA/pull/373
- PR #374 — finalisation analytics et soldes échus : https://github.com/martinot-svg/MAGNISA/pull/374
- PR #375 — allowlist des deux migrations service/réservation : https://github.com/martinot-svg/MAGNISA/pull/375
- PR #377 — correction du smoke test CRM FormDialog : https://github.com/martinot-svg/MAGNISA/pull/377
- PR #378 — tests de déduplication e-mail/téléphone et idempotence prospect-client : https://github.com/martinot-svg/MAGNISA/pull/378
- PR #381 — validation stricte des timestamps d'automatisation : https://github.com/martinot-svg/MAGNISA/pull/381 (fusionnée).
- PR #382 — validation stricte des dates de réservation et tests : https://github.com/martinot-svg/MAGNISA/pull/382 (fusionnée; validation calendaire stricte intégrée).
- PR #383 — garde contre les débordements numériques de tarification et d'analytics : https://github.com/martinot-svg/MAGNISA/pull/383 (fusionnée; garde-fous intégrés).
- PR #385 — fondation de queue durable d'automatisation (jobs persistants, idempotence, claims atomiques, leases, retry/dead-letter) : https://github.com/martinot-svg/MAGNISA/pull/385 (fusionnée). Le producteur d'événements, le dispatcher et le worker cron restent à construire.
- PR #386 — correction du backup/restore isolé en installant `btree_gist` dans la base de restauration : https://github.com/martinot-svg/MAGNISA/pull/386 (fusionnée).
- Backup chiffré + restauration de production sur base jetable : réussi sur le commit `e7786b57cbba4104eb08736f640e06363f377c6a`; artefact chiffré disponible (run : https://github.com/martinot-svg/MAGNISA/actions/runs/45736033646). Production n'a pas été modifiée.
- PR #387 — exige `orders.manage` avant enqueue d'une automation et vérifie le garde-fou dans le contrat SQL : https://github.com/martinot-svg/MAGNISA/pull/387 (CI/replay en cours au moment du relevé).
- PR #388 — demande de revue de la migration queue dans l'allowlist : https://github.com/martinot-svg/MAGNISA/pull/388 (brouillon; approbation humaine et précontrôle requis; non fusionnée).
- CI de la PR #378 : réussie (build et E2E Magnibox local).
- Sur le commit main `cf837668ed024ebf4720566b59e3feb66fef9157`, les checks `build`, `magnibox-local-e2e` et `replay` sont tous réussis.
- Le replay de migrations est réussi sur l'environnement CI isolé. Cela ne prouve pas que les migrations ont été appliquées en production.
- Le précontrôle de production après fusion #375 a réussi en lecture seule; l'étape d'application des migrations a été ignorée. Aucune application de ces migrations en production n'est confirmée par ce run.
- Le suivi actif est maintenu dans les PR #387 et #388; aucune migration de production n'est autorisée tant que la revue et le précontrôle ne sont pas verts.

## État par chantier

| Chantier | État actuel | Critères de clôture encore nécessaires |
|---|---|---|
| 1. Catalogue et tarifs | Intégré; PR #383 ajoute des garde-fous sur les débordements de calcul | Recette CRUD complète, prix figés dans les documents historiques, contrôle tenant/RLS, migration replay sur base restaurée |
| 2. Réservations | Intégré; PR #382 durcit la validation calendaire des dates et fuseaux | Tests de concurrence réelle, annulation/modification, règles de fuseau horaire, RLS multi-tenant et E2E |
| 3. CRM | Améliorations intégrées; tests de conversion, déduplication et idempotence ajoutés | Contacts multiples, historique unifié et KPI vérifiés sur plusieurs organisations |
| 4. Automatisation | PR #381 et #385 intégrées : validation stricte, queue durable, claims atomiques, leases, retry/dead-letter; PR #387 ajoute le contrôle `orders.manage` (CI en cours) | Producteur d'événements, dispatcher des actions, worker cron, métriques, vérification multi-tenant et E2E des effets externes |
| 5. Analytics | KPI de solde échu et comparaison de périodes; PR #383 ajoute une garde contre les résultats numériques non finis | Agrégats serveur supplémentaires, réconciliation avec les états comptables, validation devise/période et exports |
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
