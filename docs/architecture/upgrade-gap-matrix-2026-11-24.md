# Matrice des écarts — feuille de route MAGNISA

| Phase | Domaine | Fondations détectées | Écart prioritaire à instruire | Approche compatible |
|---|---|---|---|---|
| 1 | CRM prospects/clients | prospects, customers, conversion SQL, historique interventions, relances, notifications, RBAC | statuts exacts, contacts, détection doublons réutilisable, historique complet, KPI | compléter tables/RPC/pages existantes |
| 2 | Services/tarification | services, prix figés dans devis/commandes/factures, historique de lignes | règles horaires/journalières/participants/sessions et historique tarifaire versionné | étendre le catalogue services sans modifier les prix historiques |
| 3 | Devis/commandes | quotes, quote_lines, orders, order_lines, workflow de conversion | événements métier normalisés et vérification de toutes les transitions/immutabilités | RPC transactionnelles + triggers/audit |
| 4 | Abonnements/contrats | recurring_service_contracts, statuts et fréquences, liaison commandes/lignes | historique complet d'état, calcul renouvellement, prorata, reprise | faire évoluer le contrat récurrent existant |
| 5 | Facturation automatique | génération récurrente idempotente, pg_cron, préparation J-5, rappels | timezone, erreurs/reprises, preuves d'exécution et non-duplication | durcir le scheduler et ses tests |
| 6 | Notifications | notifications, preferences, deliveries, push, rules, events, cron | preuve E2E email/push, SMS si fournisseur déjà connecté, observabilité | étendre le centre existant |
| 7 | Réservations | stock_reservations pour quantités de stock | moteur de réservation temporelle de ressources absent de l'inventaire | nouveau domaine seulement pour salles/ressources, contraintes anti-chevauchement |
| 8 | Analyses/rentabilité | dashboard, analyse, rapports, finance, analyse.ts, exports | KPI récurrence/CRM/service/marge/churn consolidés | vues/RPC AnalyticsService TypeScript, filtrées tenant |

## Contrôle d'architecture

| Élément Laravel demandé | Équivalent présent dans MAGNISA |
|---|---|
| Eloquent Models | schéma PostgreSQL + types TypeScript |
| Controllers REST | Next.js Route Handlers |
| Policies | RLS + src/lib/permissions.ts |
| Events / Listeners | triggers PostgreSQL + notification_events |
| Jobs / Scheduler | pg_cron + routes cron sécurisées |
| Services métiers | src/lib/** + src/server/actions/** + RPC PL/pgSQL |
| Migrations | supabase/migrations/*.sql |
| Tests | Vitest + tests intégration + CI/E2E |

## Conditions d'acceptation communes

- Toute requête est limitée à l'organisation active et testée avec au moins deux tenants.
- Toute RPC sensible valide l'utilisateur, l'organisation et la permission.
- Toute table exposée a RLS et des policies testées pour SELECT/INSERT/UPDATE/DELETE.
- Les documents financiers émis et paiements comptabilisés ne sont pas réécrits ; les corrections passent par annulation/avoir/contrepassation.
- Les clés d'idempotence et contraintes uniques protègent les jobs et conversions concurrentes.
- Les migrations rejouent depuis une base vide et une restauration de test.
- Les tests n'utilisent aucune donnée réelle de production.
- Aucun déploiement ou changement de production sans validation explicite.
