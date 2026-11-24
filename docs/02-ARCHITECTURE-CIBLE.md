# Architecture cible complémentaire

## Principes

- Conserver Next.js, TypeScript, Supabase/PostgreSQL et les conventions existantes.
- Conserver `requireOrganization`, `requirePermission`, les RPC sécurisées et RLS.
- Ne pas créer de deuxième catalogue clients, services, factures, stocks ou trésorerie.
- Les services métier restent côté serveur ; les composants UI ne constituent jamais une frontière de sécurité.
- Les documents émis conservent des snapshots immuables de description, unité, quantité, prix, taxe et remise.
- Les tâches asynchrones sont idempotentes, traçables et rejouables sans doublon.
- Les événements comptables passent par le moteur comptable existant ; aucune règle commerciale ne choisit directement un compte PCG.

## Flux transversal cible

Prospect → Client → Devis → Commande → Exécution / réservation → Facture → Paiement → Trésorerie → Comptabilité → Analytics.

Chaque transition doit être autorisée côté serveur, atomique lorsque nécessaire, historisée et protégée contre les doubles soumissions.

## Réservation temporelle

Le futur moteur de réservation doit être séparé de `stock_reservations`.
Il doit gérer une ressource (salle, véhicule, équipement), une période avec fuseau horaire, un état, une capacité, des règles de conflit et une politique d'annulation.
Une contrainte PostgreSQL anti-chevauchement et une RPC transactionnelle devront être ajoutées après inventaire des extensions PostgreSQL et des conventions de migration présentes.

## Portail client / signature / paiement

Ces fonctions nécessitent :
- identité client et invitation sécurisée ;
- accès limité aux seuls documents du client ;
- jetons d'accès expirables et révocables ;
- journal d'accès et de consentement ;
- fournisseur de signature ou paiement identifié ;
- validation cryptographique des webhooks ;
- idempotence et rapprochement des paiements ;
- aucun secret fournisseur dans le navigateur.

## Assistant IA

L'assistant doit être en lecture seule par défaut, limité à l'organisation active, avec minimisation des données, journalisation et sources explicites. Toute action d'écriture doit nécessiter une confirmation humaine et passer par les actions serveur déjà autorisées.
