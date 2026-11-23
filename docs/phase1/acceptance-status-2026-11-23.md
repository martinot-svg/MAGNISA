# MAGNISA — Recette de clôture Phase 1
Date du relevé : 23 novembre 2026
Dépôt : `martinot-svg/MAGNISA`
Branche de référence contrôlée : `main` à `e0e56c05b4cdeae5db77d9cb358c85ccf8493faf`, après fusion des PR #347, #348, #350, #351 et #352.
Branche de travail du présent dossier : `qa/phase1-evidence-refresh-final-20261123`

## 1. Statut du procès-verbal

**PV DE RECETTE INTERMÉDIAIRE — PHASE 1 NON CLÔTURÉE.**

Ce document enregistre les preuves réellement consultées et les validations encore nécessaires. Il ne constitue pas une certification métier, comptable, fiscale ou de sécurité. Aucun résultat non exécuté n'est présenté comme réussi.

## 2. Exécutions GitHub Actions vérifiées

### MAGNISA CI
- Run : [45135101154](https://github.com/martinot-svg/MAGNISA/actions/runs/45135101154)
- Commit contrôlé : `ac27964b3abcf5e091a23601a26390b722be547a` (ancienne tête de la PR #348, avant sa correction finale et sa fusion).
- Conclusion du run : **success**.
- Étapes vérifiées comme réussies :
  - compilation Next.js de production ;
  - suite Vitest ;
  - génération du registre statique des interactions et contrôle des contrats boutons/formulaires ;
  - inspection automatisée des 33 PDF et rendu des premières pages ;
  - contrôles de scripts de migration et fixtures d'historique.
- Limite : ces contrôles ne prouvent pas que chaque export métier produit avec des données réelles est exact, ni que tous les parcours sont utilisables par chaque rôle.

### Supabase migration replay
- Run : [45135101272](https://github.com/martinot-svg/MAGNISA/actions/runs/45135101272)
- Commit : `ac27964b3abcf5e091a23601a26390b722be547a`.
- Conclusion du run : **success**.
- Étapes vérifiées : démarrage d'un Supabase isolé, rejeu des migrations, tests SQL d'invariants et tests de sécurité configurés dans ce workflow.
- Limite : un replay local et des tests SQL de politiques ne remplacent pas une recette navigateur avec plusieurs comptes Auth réels et plusieurs organisations.

### Périmètre non couvert par ces runs
Mise à jour : le run #45146222356 exécute désormais les parcours Auth UI et responsive. Au dernier contrôle, 71 étapes étaient réussies et l'audit responsive des modules ERP était encore en cours ; le run n'avait donc pas encore de conclusion finale.

## 3. Matrice de recette — rôles et permissions

| Contrôle | Preuve existante | État |
|---|---|---|
| Accès anonyme aux ressources protégées | tests SQL de privilèges anonymes et tests unitaires | Tests automatisés présents ; dernière exécution à confirmer dans le run de replay |
| Utilisateur authentifié sans appartenance à l'organisation | recette RBAC historique et tests SQL | Partiel ; recette Auth réelle multi-tenant à refaire |
| Membre avec permission de lecture | tests de permissions/RLS existants | Partiel ; couverture par rôle à consolider |
| Membre sans permission d'écriture | tests de permissions et contrats SQL | Partiel ; scénario UI authentifié manquant |
| Rôle comptable / gestionnaire | tests ciblés présents | Partiel ; matrice complète par rôle et module manquante |
| Révocation/changement de rôle pendant une session | aucune preuve de recette E2E complète identifiée | À exécuter |

**Critère d'acceptation :** exécuter les scénarios avec comptes de test dédiés, non-production, au minimum administrateur d'organisation, gestionnaire, comptable, opérateur sans permission financière et utilisateur sans appartenance. Vérifier lecture, création, modification, validation, paiement, export et refus d'accès. Vérifier aussi l'isolation entre deux organisations. Ne jamais utiliser un compte ou des données réelles de production pour ces essais.

## 4. Scénarios métier transversaux à exécuter

| Scénario | Modules traversés | Contrôle de sortie | État |
|---|---|---|---|
| Prospect converti en client puis devis/commande | Prospects → Clients → Services | identité, historique, statut, absence de doublon | Partiellement couvert par les PR CRM ; E2E à exécuter |
| Contrat/abonnement et facture récurrente | Clients → Services → Abonnements → Facturation | échéance, montant, unicité de facture, journalisation | Automatisations livrées ; E2E à exécuter |
| Paiement client et notification | Facturation → Trésorerie → Notifications | paiement confirmé, solde exact, notification non dupliquée | À exécuter |
| Réservation et prestation | Réservations → Clients → Services | disponibilité, statut, rattachement et historique | À exécuter |
| Facture fournisseur et paiement | Fournisseurs → Trésorerie → Comptabilité | rapprochement facture/paiement/écriture | Invariants SQL présents ; parcours UI E2E à exécuter |
| Paie et paiement | Paie → Trésorerie → Comptabilité → Notifications | bulletin, retenues, paiement idempotent, écriture | Tests de calcul/SQL présents ; recette complète non certifiée |
| Immobilisation et amortissement | Achats/Fournisseurs → Immobilisations → Comptabilité | valeur brute, amortissement, valeur nette et journal | Tests ciblés présents ; jeu métier complet à exécuter |
| Tableau de bord | Modules opérationnels → Analytique | agrégats comparés aux sources et à la balance | À exécuter |

Pour chaque scénario, conserver identifiant du jeu de test, rôle utilisé, étapes, résultat attendu/obtenu, captures ou logs expurgés, et référence du run CI. Les notifications doivent être vérifiées sur les événements, destinataires, préférences, idempotence et absence de fuite inter-organisation.

## 5. Exports et notifications

### Exports
Preuve disponible : le run CI inspecte 33 fichiers PDF et génère des aperçus. Les tests unitaires des rendus PDF et des presets sont présents.

À compléter :
- produire les exports depuis des dossiers de test avec données métier représentatives ;
- vérifier identité légale, période, devise, totaux, pagination et mentions attendues ;
- comparer les totaux exportés aux écrans et aux sources comptables ;
- tester les permissions de téléchargement ;
- contrôler les formats réels PDF et XLSX (ne pas assimiler un XML Spreadsheet renommé en .xls à un XLSX natif).

### Notifications
Preuve disponible : tests d'authentification du canal realtime et fondations du centre de notifications ; migrations et fonctionnalités de notifications présentes.

À compléter :
- déclencher chaque événement métier attendu ;
- vérifier le destinataire, le tenant, le contenu, le lien et le statut lu/non lu ;
- vérifier les préférences, les échecs et les reprises ;
- vérifier l'absence de doublons lors des retries ;
- vérifier qu'un utilisateur d'une organisation ne reçoit aucune donnée d'une autre.

## 6. Anomalies résiduelles et blocages connus

1. **États financiers PCG 2005 : bloquant.** Le dossier d'audit `docs/audits/fiscal-statements-audit-2026-11-07.md` indique que la présentation PCG, le tableau des flux, les capitaux propres, les annexes et les contrôles de clôture n'étaient pas complets. Les verrous `operatingCashFlowReconciliationReady` et `pcgPresentationReady` doivent rester bloquants jusqu'à preuve du contraire.
2. **Données comptables de production : bloquant pour une recette annuelle réelle.** L'audit cité constatait l'absence d'exercice et de période enregistrés, quatre lignes PCG à mapper, et aucun registre d'immobilisations renseigné à la date de l'audit. Ces constats doivent être actualisés en lecture seule avant toute conclusion.
3. **Rôles Auth réels : bloquant.** Aucune exécution E2E multi-comptes/multi-organisations n'a été démontrée dans les workflows examinés.
4. **Scénarios transversaux : bloquant.** Les PR fonctionnelles et les tests unitaires/SQL ne remplacent pas la preuve des parcours complets des huit modules.
5. **Responsive : preuve automatisée obtenue, recette fonctionnelle complète encore requise.** Le replay #45146802811 sur `main` a réussi les tests à 13 tailles et l'audit responsive des modules accessibles à trois classes d'écran ; cela ne certifie pas chaque action et chaque rôle.
6. **Exports et notifications : validation partielle.** Tests de composants et inspection de PDF existent, mais la recette métier avec données et rôles dédiés reste à produire.
7. **Validation professionnelle : bloquant.** La présentation PCG et les états financiers doivent être revus par une personne compétente au regard du référentiel et de la réglementation applicables à l'entité.

## 7. Conditions de clôture Phase 1

La clôture est refusée tant que les conditions suivantes ne sont pas toutes documentées :
- les 12 chantiers de Phase 1 atteignent leurs critères de sortie ;
- les tests automatisés pertinents passent sur le commit candidat ;
- les huit modules sont parcourus dans des scénarios transversaux authentifiés ;
- les rapprochements financiers ne présentent aucun écart inexpliqué ;
- les cinq composantes des états financiers applicables sont revues selon le référentiel applicable ;
- aucune anomalie bloquante ou critique ne reste ouverte ;
- les exports et notifications sont vérifiés avec des jeux de test ;
- le responsive et les permissions sont validés ;
- le PV final contient les preuves et la liste des anomalies résiduelles ;
- les validations externes requises sont obtenues.

## 8. Plan d'exécution immédiat

1. Mettre à disposition un environnement de recette isolé, deux organisations fictives et les comptes de test par rôle ; stocker les identifiants uniquement dans les secrets GitHub, jamais dans le dépôt.
2. Exécuter le script Playwright multi-module avec ces comptes et publier les rapports/captures expurgés comme artefacts CI.
3. Ajouter les scénarios E2E de conversion prospect-client, abonnement-facturation, réservation, paiement, fournisseur, paie et analytique.
4. Générer les exports depuis les jeux de données et comparer automatiquement les totaux aux données sources.
5. Déclencher et vérifier les notifications par événement, tenant et rôle.
6. Actualiser l'audit comptable sur l'environnement de recette ; corriger les écarts et obtenir la revue professionnelle.
7. Réexécuter toute la suite sur un même commit candidat et signer le PV final.

## 9. Décision

**Décision à cette date : PHASE 1 NON CLÔTURÉE.**
Les workflows verts consultés prouvent une compilation, une suite de tests automatisés et un rejeu de migrations réussis sur le commit de la PR #348. Ils ne prouvent pas encore les scénarios métier authentifiés, la recette complète des exports/notifications ni la conformité finale des états financiers.


## 9. Mise à jour des preuves après fusion des PR

Les PR #347, #348, #350 et #351 sont désormais fusionnées dans `main` :
- PR #347 — migration de rappels d'expiration : merge commit `5cbb3292b57de511b3350c9d9ca9af6b310ef77b4`.
- PR #348 — classification des flux PCG : merge commit `f3a6926fd407dc4cb954a76e24d09fdb5d4873d3`.
- PR #350 — dossier de recette : merge commit `0a7acea34d0422477c0dfb4e3aa1e1ff8c0acf8c`.
- PR #351 — export XLSX natif : merge commit `bd88e1c94549816a312bcfbd10e335a30d5a7766`.

Nouvelles exécutions observées sur la tête corrigée de la PR #348 (`4907b4c53a49ca0cf6a1cfe7b4536e0e7fdb28f7`) :
- [MAGNISA CI #45146222368](https://github.com/martinot-svg/MAGNISA/actions/runs/45146222368) : **success**, deux jobs réussis (build/Vitest et MAGNIBOX local E2E).
- [Supabase migration replay #45146222356](https://github.com/martinot-svg/MAGNISA/actions/runs/45146222356) : **en cours au dernier contrôle** ; rejeu des migrations et contrats SQL réussis, tests Auth UI CRM/paie/immobilisations/stock réussis, responsive 13 tailles réussi ; audit responsive module par module encore en cours. Ne pas qualifier ce replay de succès avant sa conclusion finale.

La correction de l'export Excel est intégrée par PR #351 et le classeur est généré au format XLSX natif. La validation du contenu métier, des données d'identification et des permissions d'export reste à effectuer.

La fusion des PR ne clôture pas la Phase 1 : les scénarios transversaux complets, les états financiers PCG, les rapprochements, la recette exhaustive des rôles, la paie et la validation professionnelle restent des critères distincts.


## 9. Actualisation du 23 novembre 2026 — exécutions récentes

- PR #352 est fusionnée dans `main` : merge commit `e0e56c05b4cdeae5db77d9cb358c85ccf8493faf`.
- [MAGNISA CI #45148301656](https://github.com/martinot-svg/MAGNISA/actions/runs/45148301656) : succès sur la PR #352.
- [Supabase replay #45146802811](https://github.com/martinot-svg/MAGNISA/actions/runs/45146802811) : succès sur `main` à `f3a6926fd407dc4cb954a76e24d09fdb5d4873d3`, incluant le rejeu des migrations, les scénarios Auth locaux ciblés et l'audit responsive des modules accessibles.
- PR #353 reste ouverte et non fusionnée. [MAGNISA CI #45148647430](https://github.com/martinot-svg/MAGNISA/actions/runs/45148647430) : deux jobs réussis sur son commit `752ce5c6a803dbc3ee99acb469c5a4b286a3f925`.
- [Supabase replay #45148647452](https://github.com/martinot-svg/MAGNISA/actions/runs/45148647452) : encore en cours au dernier relevé, 71 étapes réussies sur 80 et audit responsive final module par module en cours. Aucun succès final n'est revendiqué pour ce run.

La recette des exports métier avec jeu de données de référence et permissions par rôle reste à exécuter. La réussite du build et des tests automatisés de PR #353 n'est pas une preuve d'exactitude comptable des PDF/XLSX.


## 10. Addendum de vérification finale — 23 novembre 2026, après clôture des workflows

Cet addendum remplace les statuts « en cours » mentionnés dans les relevés antérieurs de ce document.

### Workflows et commits
- [Supabase replay #45148647452](https://github.com/martinot-svg/MAGNISA/actions/runs/45148647452) : **success**, commit `752ce5c6a803dbc3ee99acb469c5a4b286a3f925`. Le job `replay` est terminé avec succès ; toutes les étapes exécutées sont réussies, à l'exception d'une étape de diagnostic conditionnelle explicitement ignorée.
- [MAGNISA CI #45148647430](https://github.com/martinot-svg/MAGNISA/actions/runs/45148647430) : **success**, même commit ; jobs `build` et `magnibox-local-e2e` réussis.
- [MAGNISA CI #45149985742](https://github.com/martinot-svg/MAGNISA/actions/runs/45149985742) : **success**, commit `35b23686f02efa77d7a71b30c6a796f0a5194e8f` de PR #354 ; jobs `build` et `magnibox-local-e2e` réussis.
- [MAGNISA CI #45149183974](https://github.com/martinot-svg/MAGNISA/actions/runs/45149183974) : **success** sur `main`, commit `e0e56c05b4cdeae5db77d9cb358c85ccf8493faf`.

PR #353 et PR #354 demeurent ouvertes et non fusionnées. Aucune fusion ni aucun déploiement n'a été effectué.

### Actualisation comptable en lecture seule
Une nouvelle lecture de la base active (PostgreSQL 17) corrige plusieurs constats devenus obsolètes dans l'audit du 7 novembre :
- un exercice 2026 existe désormais, mais son statut est `open` ; il ne constitue donc pas un exercice clôturé validable ;
- le grand livre consulté contient 83 écritures et 172 lignes ; les 83 écritures ressortent équilibrées dans la vue d'intégrité ;
- la vue effective `pcg2005_journal_lines` ne laisse que deux lignes de factures fournisseurs au statut `a_mapper` ; deux autres lignes comparables ont une correspondance provisoire au compte 606, avec pièces justificatives toujours requises ;
- les deux lignes non mappées ne disposent pas de code de compte de charge explicite, de pièce jointe ni de justificatif fiscal exploitable. Leur nature exacte ne permet pas de choisir sans preuve entre achats de prestations, fournitures non stockées ou sous-traitance. **Aucune correspondance n'est inventée** ;
- aucun actif immobilisé n'est enregistré ;
- le profil fiscal de l'entité reste incomplet/non confirmé ;
- les vues de lacunes de règles de présentation du bilan actif et passif ne remontent pas de compte PCG sans règle, mais cela ne suffit pas à valider les états complets.

Les deux verrous `operatingCashFlowReconciliationReady=false` et `pcgPresentationReady=false` restent fermés dans le code. L'exercice est ouvert, les justificatifs fournisseurs sont incomplets et le registre des immobilisations est vide : la certification comptable demeure donc bloquée. Aucune écriture, migration ou donnée de production n'a été modifiée pendant cette inspection.

### Décision actualisée
Les workflows listés ci-dessus sont verts sur leurs SHA exacts. Cela clôt le contrôle de la priorité 1 pour ces exécutions, mais **ne clôt pas la Phase 1**. Les critères comptables, les parcours métier complets, la matrice RBAC exhaustive, la recette paie/notifications et la validation professionnelle restent à satisfaire.


## 10. Addendum de vérification GitHub — 23 novembre 2026

La référence actuelle de `main` contrôlée est `c8503aed199ecb9f5161cbdb79f7c4ab7f4afc0d`.

Mises à jour qui remplacent les états historiques décrits plus haut :
- PR #353, #354 et #355 sont toutes fusionnées.
- La PR #355 a été contrôlée sur le SHA `1d088c485ccad62fc2cd75876195cf9524319630`.
- CI MAGNISA #45165264256 : succès.
- Replay Supabase #45165264320 : succès.
- Replay Supabase #45170478564 : succès, y compris les étapes exécutées de contrôles SQL/RLS, tests authentifiés ciblés et audit responsive. Artefacts publiés : `magnisa-all-modules-responsive` et `magnisa-responsive-viewports`.
- La revue indépendante visible sur la PR #355 est un commentaire (`COMMENTED`), et non une approbation (`APPROVED`).

Le registre d'interactions reste un inventaire statique : les éléments y sont initialisés à `NOT_TESTED` jusqu'à preuve d'exécution runtime. Le succès CI ne certifie donc pas chaque action, chaque permission, chaque rôle et chaque chaîne métier des huit modules.

**Décision inchangée : PHASE 1 NON CLÔTURÉE.** Restent notamment à démontrer la matrice RBAC complète, les chaînes E2E intermodules, la recette des notifications et exports par rôle et tenant, les rapprochements financiers, les états PCG approuvés, la validation réglementaire de la paie et le PV final signé.

Aucune donnée de production, écriture comptable, migration de production ni readiness flag n'a été modifié lors de cette actualisation documentaire.


## 11. Provisionnement SaaS et parité existants/nouveaux tenants

Un contrôle supplémentaire a été ajouté au test navigateur `scripts/ci/company-onboarding-browser-smoke.mjs` sur la branche de travail :
- adhésion active du créateur au rôle `owner` ;
- présence des six séquences documentaires par organisation ;
- vérification de leurs préfixes et valeurs initiales.

**Résultat : EN ATTENTE CI** sur la branche de cette PR ; aucun succès n'est revendiqué avant la fin du workflow.

La base MAGNISA utilise un schéma Supabase partagé et un cloisonnement par `organization_id`. Les scénarios multi-tenant existants vérifient certains refus d'accès entre organisations. Il manque encore une recette d'upgrade d'une base contenant plusieurs tenants déjà existants : conservation de leurs données et paramètres, application des nouvelles fonctionnalités après déploiement central, compatibilité des migrations et absence de fuite entre tenants.

Ce point est un critère obligatoire de l'architecture SaaS centrale. La Phase 1 reste NON CLÔTURÉE tant que cette preuve n'est pas obtenue.
