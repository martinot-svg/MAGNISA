# Audit d'architecture MAGNISA — 24 novembre 2026

## Périmètre et méthode

Audit statique du dépôt `main` à partir de l'arbre Git, des manifestes, des migrations SQL, des pages Next.js, des bibliothèques TypeScript, des actions serveur, des routes API et des scripts de test.

Référence observée : commit `ea4520af3496c75dcb679c26573df11da74de248`.

Inventaire automatique :
- 1 032 fichiers suivis dans l'arbre inspecté.
- 489 fichiers SQL au total, dont 271 migrations SQL actives hors répertoires d'archives.
- 223 fichiers TypeScript et 149 fichiers TSX.
- Application Next.js 15.5 / React 19 / TypeScript 5.8, Supabase/PostgreSQL 17, Supabase Auth + RLS, déploiement Vercel.
- Aucun manifeste Laravel/Composer, aucun dossier `app/Models`, `app/Http/Controllers`, `routes/api.php` ou structure Eloquent détecté dans l'arbre inspecté.

Limite : il s'agit d'un audit statique du code versionné. Il ne prouve pas à lui seul l'état réel de la base de production, les extensions actives, les secrets, les réglages Vercel/Supabase ni l'exécution de tous les parcours en navigateur.

## Décision d'architecture impérative

Le dépôt n'est pas une application Laravel/PHP. Il s'agit d'un ERP SaaS Next.js/TypeScript avec Supabase/PostgreSQL.

En conséquence :
- Ne pas introduire Laravel, PHP, Eloquent, migrations Laravel, contrôleurs Laravel, queues Laravel ou un second système RBAC.
- Étendre les pages Next.js, Server Actions, routes API, bibliothèques TypeScript, migrations Supabase/PostgreSQL, RPC transactionnelles, RLS, cron existants et tests Vitest/CI.
- Réutiliser `requireOrganization()`, `hasPermission()`, `assertPermission()`, `audit_event()`, `audit_logs`, le centre de notifications et les moteurs de facturation existants.
- Ne pas créer une seconde table de clients : le modèle métier existant est `customers`.
- Ne pas remplacer `recurring_service_contracts` par un nouveau moteur de contrats sans démonstration d'une incompatibilité métier.
- Les écritures financières validées doivent continuer à passer par des RPC transactionnelles et des règles d'immutabilité, jamais par une écriture directe du navigateur.

## Inventaire existant vérifié

### Socle et sécurité
- Organisation multi-tenant : `organizations`, `organization_members`, sélection d'organisation et contrôle d'appartenance.
- Contexte applicatif : `src/lib/current-org.ts`.
- Permissions : `src/lib/permissions.ts`, permissions stockées dans `role_permissions`, contrôles côté serveur et politiques PostgreSQL.
- RLS initiale couvrant notamment `customers`, `prospects`, `services`, `quotes`, `orders`, `invoices`, paiements, journaux comptables et audit.
- Audit existant : `audit_logs`, `audit_row_change()`, `audit_event()` et déclencheurs d'historisation.

### Phase CRM
- Tables existantes : `prospects`, `customers`, `prospect_interventions`, `prospect_intervention_history`, `commission_calculations`, `commission_allocations`.
- Pages existantes : `/prospects`, `/prospects/[id]`, `/clients`, `/clients/[id]`.
- Conversion automatique d'un prospect gagné vers un client via `auto_convert_won_prospect()` et RPC `convert_prospect_to_customer()`.
- Contrôle des doublons à la conversion, suivi des relances et notifications CRM déjà présents.
- Restriction des opérations commerciales pour les clients inactifs/suspendus introduite par migration.
- Écart restant à vérifier : états demandés exactement (actif/inactif/perdu/archivé), détection de doublons réutilisable et complète, conservation vérifiable de tout l'historique lors de la conversion, contacts/responsables et KPI CRM consolidés.

### Phase Services et tarification
- Table `services` et écran `/services` déjà présents.
- Les lignes de devis, commandes et factures conservent les prix, quantités, remises, taxes et montants appliqués.
- Les migrations de compatibilité tarifaire et de conservation des lignes de vente existent.
- Écart identifié : aucun moteur générique `service_pricing_rules` / `service_price_histories` n'a été identifié dans le premier inventaire. Les tarifs horaire, journalier, par participant, par session et mixtes doivent être comparés au schéma actuel avant toute création.

### Phase devis et commandes
- Tables `quotes`, `quote_lines`, `orders`, `order_lines`, `invoices` et `invoice_lines`.
- Parcours devis accepté → commande et conservation des instantanés de prix déjà présents.
- Pages `/devis` et `/commandes`.
- Les contrôles d'accès, numérotation et écritures sensibles s'appuient sur les fonctions PostgreSQL existantes.

### Phase abonnements et contrats
- Table existante : `recurring_service_contracts`, liée à `orders`, `order_lines`, `customers` et `services`.
- Fréquences déjà présentes : mensuelle, trimestrielle, semestrielle et annuelle.
- Statuts actifs, suspendus, annulés et terminés.
- Création de contrat, suspension/reprise/résiliation et génération périodique de brouillons de factures.
- Écart : le nom et le modèle existants diffèrent des tables génériques `subscriptions` et `contracts) proposées. Ne pas créer ces tables en doublon sans cas d'usage démontré. Vérifier les règles de date de renouvellement, reprise après suspension, prorata et historique d'état.

### Phase facturation récurrente
- Générateur SQL idempotent de brouillons récurrents, exécution planifiée via `pg_cron`.
- Préparation de factures à cinq jours, rappels d'échéance et rappels de fin de contrat ajoutés par migrations.
- Contrainte unique par organisation/contrat/période pour réduire les doublons.
- Écart : vérifier la cohérence de la date locale Madagascar, les périodes, les contrats suspendus, les échecs/reprises, la facturation J-5 et l'observabilité du cron sur un environnement de test.

### Phase notifications
- Centre existant : `notifications`, `notification_preferences`, `push_subscriptions`, `notification_deliveries`, `notification_rules`, `notification_events`.
- Interface `/notifications` et route sécurisée `/api/cron/notifications`.
- Les rappels de factures, relances prospects et échéances de contrats récurrents sont appelés par le cron.
- Écart : vérifier l'envoi email/push de bout en bout, les préférences par catégorie, les tentatives, les erreurs fournisseur et les éventuels SMS. Ne pas ajouter un second centre.

### Phase réservations
- `stock_reservations` existe pour la réservation de quantités de stock et les livraisons de commandes.
- Aucun moteur de réservation de salles, bureaux, logements ou ressources avec créneaux calendaires n'a été identifié dans les migrations actives examinées.
- Il faut distinguer explicitement réservation de stock et réservation de ressources/temps. Une nouvelle fonctionnalité de réservation de ressources pourrait être nécessaire, après définition des règles de disponibilité, fuseaux horaires, capacité, conflits et annulation.

### Phase analyses et rentabilité
- Pages `/analyse`, `/rapports`, `/dashboard`, comptabilité et états financiers.
- Bibliothèque `src/lib/analysis.ts` avec analyse des créances, trésorerie et écarts budgétaires.
- Exports PDF/XLSX et données comptables déjà présents.
- Écart : KPI CRM et récurrence, revenus par service, marge/rentabilité par service, churn/renouvellement et impayés consolidés doivent être audités contre les requêtes et vues existantes avant extension.

## Modèles, contrôleurs, services, événements et jobs

Le dépôt n'utilise pas les classes Laravel Eloquent/Controllers/Policies/Events/Listeners/Jobs. Les équivalents architecturaux actuels sont :
- Modèles de données : tables PostgreSQL, contraintes, vues et types TypeScript.
- Logique métier : fonctions RPC PL/pgSQL, modules `src/lib/**` et Server Actions sous `src/server/actions/**`.
- Contrôleurs REST : Route Handlers Next.js sous `src/app/api/**/route.ts`.
- Policies : RLS PostgreSQL et vérifications de permissions serveur.
- Événements/listeners : triggers SQL, fonctions métier et `notification_events`.
- Jobs : fonctions planifiées via `pg_cron` et routes cron sécurisées.
- Tests : Vitest, tests d'intégration et scripts de smoke test CI.

## Risques à ne pas introduire

1. Double système de données ou d'authentification (Laravel + Supabase).
2. Tables clientes, contrats, notifications ou audit dupliquées.
3. Réécriture rétroactive des prix, commandes, factures ou paiements validés.
4. RPC `SECURITY DEFINER` exposées sans contrôle strict d'identité, d'organisation et de permission.
5. Policies RLS limitées à `TO authenticated` sans prédicat tenant.
6. Cron sans authentification, idempotence, journal d'exécution et alerting.
7. Réservation sans contrainte transactionnelle contre les chevauchements.
8. KPI calculés à partir de données de tenants différents ou de factures annulées.

## Plan d'exécution recommandé

1. Verrouiller le stack existant et produire la cartographie exhaustive table ↔ écran ↔ action serveur ↔ RPC ↔ RLS ↔ test.
2. Compléter les lacunes CRM sans recréer prospects/clients.
3. Ajouter le moteur de règles tarifaires versionnées uniquement si le schéma actuel ne couvre pas les besoins.
4. Renforcer les instantanés de prix et le workflow devis/commande.
5. Compléter le cycle de vie des contrats récurrents existants.
6. Durcir la facturation J-5, l'idempotence, la reprise et l'observabilité.
7. Compléter les canaux du centre de notifications existant.
8. Concevoir un moteur distinct de réservation de ressources, sans le confondre avec le stock.
9. Consolider les KPI dans les rapports existants avec tests d'isolation tenant.
10. Exécuter les tests unitaires, intégration, RLS, migration replay et E2E avant toute fusion.

## Statut

Cet audit ne prétend pas que les huit phases sont achevées. Il établit que plusieurs fondations et parcours sont déjà présents, et que le travail doit être ciblé sur les écarts réels. Aucun changement de schéma, déploiement, restauration ou écriture en production n'est effectué par cet audit.
