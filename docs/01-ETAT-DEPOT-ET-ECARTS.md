# État du dépôt et écarts à traiter

## Éléments observés dans `main`

Le dépôt consulté expose déjà notamment :
- `src/lib/features.ts` : catalogue des modules et navigation ;
- `src/components/app-shell.tsx` : filtrage des modules selon l'organisation et les permissions ;
- `src/app/(app)/services/page.tsx` : création, modification et archivage des services ;
- `supabase/migrations/` : historique des schémas et migrations ;
- `docs/architecture/upgrade-gap-matrix-2026-11-24.md` : matrice d'écarts fonctionnels.

Le catalogue de services existant utilise actuellement un champ `unit` libre dans les formulaires. Les prestations récurrentes et leurs fréquences sont déjà présentes.

## Écarts explicitement identifiés par la matrice existante

1. CRM : compléter les statuts, contacts, détection de doublons, historique et KPI.
2. Services : règles horaires/journalières/participants/sessions et historique tarifaire versionné.
3. Devis/commandes : normaliser les événements métier et tester les transitions et immutabilités.
4. Contrats récurrents : historique des états, renouvellement, prorata et reprise.
5. Facturation automatique : fuseaux horaires, erreurs/reprises, preuves d'exécution et non-duplication.
6. Notifications : preuves E2E e-mail/push, SMS uniquement si un fournisseur est configuré, observabilité.
7. Réservations : moteur temporel de ressources (salles, équipements, véhicules), distinct des réservations de stock.
8. Analytics : KPI consolidés CRM, services, récurrence, marge et attrition.

## Autres propositions de la feuille de route

Portail client, signature électronique, paiements en ligne et assistant IA sont des évolutions à instruire. Elles ne doivent pas être déclarées disponibles tant que les fournisseurs, flux de consentement, contrôles d'accès, webhooks, journaux et tests n'ont pas été implémentés.

## Règle de livraison

Chaque domaine doit être marqué séparément :
- existant et vérifié ;
- existant mais incomplet ;
- à développer ;
- bloqué par une dépendance externe ;
- validé par tests.

Ne pas déduire l'état opérationnel d'une simple présence de page ou de table.
