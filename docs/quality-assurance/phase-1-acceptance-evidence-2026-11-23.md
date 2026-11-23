# MAGNISA — Dossier de recette Phase 1 (état au 23 novembre 2026)

- Dépôt : `martinot-svg/MAGNISA`
- Branche de ce dossier : `qa/phase1-acceptance-evidence-20261123`
- Référence principale examinée : `main` à `5cbb3292b57de511b3350c9d9ca9af6b310ef77b4`
- Référence CI complémentaire : tête de PR #348, `ac27964b3abcf5e091a23601a26390b722be547a`
- Décision : **RECETTE PARTIELLE — PHASE 1 NON CLÔTURÉE**.

Ce document distingue les tests effectivement exécutés dans GitHub Actions, les contrôles unitaires/SQL, et les scénarios qui restent à prouver. La réussite d'un workflow ne vaut pas validation générale des huit modules.

## 1. Preuves CI vérifiées

Les jobs et étapes ci-dessous ont été relus dans le détail via l'API GitHub Actions. Ils correspondent à la tête de PR #348, et non à un déploiement ou à une validation de production.

| Exécution | Résultat observé | Portée |
|---|---|---|
| [CI MAGNISA #45135101154](https://github.com/martinot-svg/MAGNISA/actions/runs/45135101154) | 2 jobs terminés avec succès | Build, Vitest, vérification de 33 fichiers PDF, contrôles MAGNIBOX locaux |
| [Replay Supabase #45135101272](https://github.com/martinot-svg/MAGNISA/actions/runs/45135101272) | Job `replay` terminé avec succès | Rejeu migrations PostgreSQL 17, contrats SQL, utilisateur Auth local, scénarios authentifiés, navigateur et responsive |

Étapes authentifiées explicitement réussies dans le replay :
- création d'un utilisateur Auth local de test et amorçage de données isolées ;
- opérations de stock, livraison, transferts, réservation concurrente et isolation de tenant ;
- parcours comptables des immobilisations et contrôle RLS ;
- RPC CRM, commissions et isolation multi-tenant ;
- cycle de paiement de paie et idempotence ;
- interface paie/immobilisations, actions CRM, actions stock ;
- connexion par identifiant, onboarding entreprise en cinq étapes ;
- scénarios UI Orbit Action ;
- contrôles responsive à 13 tailles, puis audit des modules accessibles à trois classes d'écran.

Les étapes de nettoyage de Supabase, du serveur local et du relais SMTP isolé ont également réussi. Cela confirme un environnement de recette éphémère ; cela ne constitue pas une recette Auth réelle sur un tenant de production.

## 2. Tests des rôles et permissions avec comptes authentifiés

### Faits prouvés
- Le pipeline crée un utilisateur authentifié dans la base Supabase locale éphémère.
- Des parcours UI CRM, paie, immobilisations et stock sont exécutés sous cette identité.
- Des tests SQL de RLS, de permissions RPC et d'isolation multi-tenant sont présents et passent dans le replay.
- La matrice unitaire documentaire couvre 11 rôles, 4 périmètres et les permissions déclarées dans `src/lib/document-permissions.matrix.test.ts`.
- Des scénarios de collaboration et d'isolation multi-tenant sont exécutés pour certains domaines.

### Non prouvé — reste bloquant
- Matrice exhaustive de chaque rôle réel (owner, admin, direction, finance, comptable, commercial, caisse, RH, auditeur, salarié, lecteur) sur les huit modules.
- Deux identités Auth réelles au minimum dans chaque scénario inter-entreprises, avec preuve positive et négative par rôle.
- Tests de navigateur pour chaque permission sensible : lecture, création, modification, validation, suppression, export et accès aux pièces.
- Vérification systématique qu'une action interdite est refusée côté serveur et pas seulement masquée dans l'interface.

**Verdict : PARTIEL.** Les tests authentifiés existent et réussissent sur plusieurs parcours ; ils ne certifient pas l'ensemble de la matrice RBAC des huit modules.

## 3. Scénarios métier complets des huit modules

| Module | Preuve disponible | Verdict de recette transverse |
|---|---|---|
| Prospects | Tests UI CRM et RPC collaboratives | Partiel |
| Clients | Conversion et interactions CRM couvertes par tests ciblés ; chaîne complète non démontrée dans ce run | Partiel |
| Services | Pas de scénario E2E complet avec réservation et facturation démontré | À prouver |
| Abonnements | Rappels et facturation récurrente ont des changements récents ; cycle complet non démontré dans ce run | À prouver |
| Facturation | Tests de paiement/CRM et contrôles comptables ciblés ; cycle devis → facture → avoir → paiement → export non démontré intégralement | Partiel |
| Notifications | Tests ciblés de notifications/collaboration et outbox dans des domaines spécifiques ; couverture de tous les événements métier non démontrée | Partiel |
| Réservations | Pas de scénario complet de réservation client/service et notifications associé démontré dans ce run | À prouver |
| Analytique | Pas de rapprochement E2E démontré entre opérations des huit modules et agrégats analytiques | À prouver |

Scénarios de chaîne obligatoires avant clôture :
1. Prospect créé → qualifié → converti en client → service associé.
2. Service → abonnement → échéance → facture → paiement → notification → historique client.
3. Réservation → disponibilité du service → confirmation → notification → présence/annulation → analytique.
4. Facture fournisseur → validation → paiement → mouvement de trésorerie → écriture comptable → rapprochement.
5. Paie → validation → paiement idempotent → écriture comptable → bulletin protégé → notification autorisée.
6. Écritures opérationnelles → rapprochements → états financiers → exports → archivage et audit.

Chaque scénario doit être exécuté avec identités Auth, données synthétiques isolées, assertions de base de données, assertions UI, preuve d'absence de fuite inter-tenant et nettoyage.

**Verdict : PARTIEL.** Plusieurs parcours fonctionnels sont exécutés par CI, mais l'enchaînement bout en bout des huit modules n'est pas démontré.

## 4. Vérification des exports et notifications

### Exports — preuves
- Le job CI #45135101154 a inspecté 33 fichiers PDF et généré des captures de première page.
- Le workflow de replay valide la syntaxe des scripts de sauvegarde/export et restauration Storage.
- L'audit financier du 7 novembre signale que l'export Excel des états financiers est un XML Spreadsheet 2003 portant l'extension `.xls`, et non un classeur natif `.xlsx`.
- Le même audit signale des champs d'identification et de validation manquants dans les états exportés.

### Exports — reste à prouver
- Contenu et cohérence métier des PDF devis, factures, avoirs, reçus, bulletins, rapports et états financiers.
- Contrôle des montants, taxes, monnaies, dates, identité de l'entité, pagination, totaux, comparatifs et statut de validation.
- Autorisations d'export par rôle et absence de fuite inter-entreprises.
- Format réel des fichiers Excel/CSV, ouverture par outils standards, types de cellules, encodage, formules et extensions exactes.
- Export sur jeu de données de référence rapproché à la base.

### Notifications — preuves
- Tests unitaires d'authentification Realtime : JWT défini avant abonnement privé, refus si session absente ou erreur de session.
- Le replay valide des flux de collaboration/notifications MAGNIBOX, outbox, reprises, dead-letter, rappels d'agenda et certaines notifications associées à des scénarios.
- Les contrôles de livraison et d'idempotence du pipeline MAGNIBOX passent sur l'environnement local isolé.

### Notifications — reste à prouver
- Matrice événement × destinataire × rôle × canal (in-app, e-mail, push le cas échéant) sur les huit modules.
- Vérification des contenus, liens, langues, fuseaux horaires, dates d'échéance, doublons, retries, échecs définitifs et préférences.
- Preuve qu'aucune notification n'est envoyée à un utilisateur d'une autre organisation.
- Vérification des événements facturation, abonnements, paiements, réservations, paie et analytique sur les scénarios métier réels.

**Verdict : PARTIEL.** Des contrôles PDF et notifications existent, mais ils ne constituent pas une recette exhaustive des exports et notifications métier.

## 5. Anomalies résiduelles et risques bloquants

Les anomalies ci-dessous sont issues des audits et preuves examinés. Leur statut doit être recontrôlé sur le code et les données du jour avant toute correction de schéma ou de production.

| ID | Sévérité | Anomalie / risque | Condition de levée |
|---|---|---|---|
| QA-01 | Bloquante | Matrice RBAC authentifiée non exhaustive sur les huit modules | Scénarios positifs/négatifs pour chaque rôle, module et permission sensible |
| QA-02 | Bloquante | Chaînes métier E2E des huit modules non démontrées | Scénarios 1 à 6 exécutés et preuves conservées |
| QA-03 | Bloquante | Exports financiers incomplets selon audit du 07/11 ; export `.xls` non natif `.xlsx` | Corriger les formats et champs ; tests de contenu et autorisation réussis |
| QA-04 | Bloquante | Notifications métier non couvertes exhaustivement | Matrice événements/destinataires/canaux et tests multi-tenant réussis |
| QA-05 | Bloquante | États financiers PCG non terminés ; verrous `pcgPresentationReady` et rapprochement des flux opérationnels maintenus fermés dans l'état examiné | Calculs PCG complets, jeu de référence, revue professionnelle et critères de readiness satisfaits |
| QA-06 | Bloquante | L'audit du 07/11 constatait zéro exercice/période comptable en production et 4 lignes PCG non mappées | Nouvelle requête de lecture seule, exercice de test contrôlé et zéro ligne non justifiée |
| QA-07 | Bloquante | Paie non certifiée dans l'audit de recette du 18/10 | Règles réglementaires datées, bulletins de référence, rôles réels, recette E2E et revue indépendante |
| QA-08 | Majeure | Les preuves de responsive ne valent pas validation fonctionnelle de chaque écran et action | Captures, rapports et tests interactifs par module et rôle |
| QA-09 | Majeure | La réussite CI sur PR #348 ne signifie pas que ses modifications sont intégrées à `main` | Revue/merge séparés après validation ; ne pas présumer de l'intégration |
| QA-10 | Bloquante | Absence de procès-verbal final signé par le responsable métier/comptable | Validation et signature des responsables désignés |

Aucun écart financier ne doit être régularisé automatiquement pour faire passer un test. Chaque écart doit être expliqué, justifié par pièce et approuvé.

## 6. Procès-verbal de recette — décision provisoire

**Périmètre :** tests authentifiés disponibles, contrôles SQL/RLS, scénarios UI existants, contrôles PDF/notifications et audit financier documentaire.

**Résultats :**
- [x] Deux workflows CI consultés et terminés avec succès sur la tête de PR #348.
- [x] Utilisateur Auth local créé dans le replay isolé.
- [x] Parcours authentifiés CRM, paie/immobilisations, stock, onboarding et Orbit exécutés.
- [x] Contrôles SQL/RLS et multi-tenant ciblés exécutés.
- [x] Contrôle de 33 fichiers PDF dans le job de build.
- [x] Nettoyage des environnements CI isolés réussi.
- [ ] Matrice exhaustive des rôles sur huit modules.
- [ ] Six chaînes métier E2E vérifiées intégralement.
- [ ] Recette complète des exports PDF/Excel/CSV par rôle.
- [ ] Recette complète des notifications métier par module, destinataire et canal.
- [ ] Rapprochements financiers sans écart inexpliqué sur un exercice représentatif.
- [ ] États financiers PCG contrôlés et approuvés.
- [ ] Corrections de toutes les anomalies bloquantes.
- [ ] Validation/signature métier et comptable.

**Décision : REFUS DE CLÔTURE DE LA PHASE 1 à cette date.** Ce refus ne remet pas en cause les jobs CI réussis ; il constate que les critères de clôture globaux ne sont pas tous démontrés.

## 7. Conditions cumulatives de clôture officielle

La Phase 1 pourra passer à « clôturée » uniquement si :
1. Les 12 tâches du plan de Phase 1 ont chacune leurs critères de validation documentés et atteints à 100 %.
2. Les workflows automatisés pertinents sont verts sur le commit candidat final.
3. Les huit modules ont des scénarios E2E documentés, exécutés avec comptes authentifiés.
4. Les rapprochements clients, fournisseurs, banque, caisse, paie et grand livre n'ont aucun écart inexpliqué.
5. Les états financiers correspondent au référentiel applicable à l'entité et à la période ; la revue professionnelle est jointe.
6. Toutes les anomalies bloquantes sont corrigées et les anomalies majeures acceptées explicitement.
7. Les exports et notifications sont contrôlés sur leurs contenus, autorisations, destinataires et effets.
8. Le dossier de preuve (logs CI, rapports JSON, captures, jeux de données anonymisés, rapprochements et PV signé) est conservé sur GitHub.
9. Aucune migration ou déploiement de production n'est effectué par cette recette sans procédure et autorisation distinctes.

## 8. Procédure de relance des contrôles

Sur un runner CI isolé, après fourniture des secrets de recette par GitHub Actions (jamais dans le dépôt ni dans le chat) :
- rejouer `Supabase migration replay` ;
- compléter le jeu de tests Auth multi-rôles et multi-tenant ;
- exécuter les scénarios E2E de chaînes métier ;
- produire un rapport d'exports (format, contenu, permissions) et un rapport de notifications (événement, destinataire, canal, résultat) ;
- exécuter les rapprochements financiers sur données synthétiques de référence ;
- joindre les rapports et captures au procès-verbal.

**Sécurité :** ne pas utiliser de données personnelles ou financières de production dans les tests ; ne pas publier de secrets ; ne pas appliquer de migration ni écrire dans la base de production ; ne pas désactiver les verrous de readiness pour obtenir artificiellement un résultat vert.
