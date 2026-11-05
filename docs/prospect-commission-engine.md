# MAGNISA : moteur de primes et commissions

## Décisions fonctionnelles

- Base de calcul : chaque politique définit sa base financière et son taux de prime.
- Répartition : pourcentage par rôle contributeur. Les règles configurées totalisent 100 %.
- Validation : exclusivement par les rôles finance_manager ou accountant. Le propriétaire ne peut pas approuver ni payer une prime s'il n'a pas l'un de ces rôles.
- Paiement : enregistrement séparé, avec référence, date, possibilité de paiements partiels et contrôle du solde.
- Conversion prospect-client : action explicite et atomique. Elle crée le client et marque le prospect gagné dans la même transaction.

## Bases financières disponibles dans une politique

1. `order_total` : total d'une commande rattachée au client issu du prospect.
2. `invoice_paid_amount` : montant encaissé d'une facture rattachée au client. Le calcul n'est autorisé que lorsque la facture est intégralement réglée.
3. `fixed_amount` : montant de base fixé dans la politique.

Le taux de prime de la politique s'applique à la base vérifiée par PostgreSQL. Le montant de base n'est jamais fourni librement par le navigateur.

## Attribution des contributions

- `originator` : apporteur initial.
- `qualifier` : qualification et suivi.
- `negotiator` : négociation.
- `closer` : finalisation.
- Un membre déclare uniquement ses propres contributions.
- Plusieurs personnes peuvent occuper le même rôle ; la part du rôle est divisée à parts égales entre elles.
- Les parts des rôles absents sont redistribuées proportionnellement entre les rôles représentés.
- Le dernier montant d'allocation absorbe l'écart d'arrondi afin que la somme des allocations corresponde exactement au total de prime.

## Cycle de vie

`Prospect créé` → `contributions déclarées` → `prospect gagné et client créé` → `prime calculée` → `validation finance` → `partiellement payée` → `payée`

Le calcul exige un prospect au statut `won` et un `converted_customer_id`. Une conversion est idempotente. Un doublon potentiel de client basé sur l'e-mail ou le téléphone bloque la conversion pour éviter de créer un deuxième client.

## Sécurité et traçabilité

- Isolation multi-entreprise par `organization_id` et clés étrangères composites.
- RLS sur toutes les nouvelles tables et lecture limitée aux allocations propres ou aux vues équipe autorisées.
- Les opérations sensibles passent par des RPC PostgreSQL à privilèges contrôlés, avec contrôle de `auth.uid()` et des permissions.
- Les fonctions d'approbation et de paiement ne sont exécutables que par les rôles finance autorisés.
- Clés d'idempotence sur les calculs et paiements ; référence de paiement unique par allocation.
- Snapshot immuable des paramètres de politique utilisés pour chaque calcul.
- États distincts : calculée, validée à payer, partiellement payée, payée et rejetée.
- Journalisation dans `audit_logs` des créations, conversions, calculs, validations, politiques et paiements.

## Limites volontairement séparées

La conversion ne crée ni devis, ni commande, ni facture. La validation ou le paiement d'une prime ne génère pas automatiquement de bulletin de paie ni d'écriture comptable. Le traitement social, fiscal et comptable doit être défini et validé séparément avant raccordement au moteur de paie ou au journal PCG.

## Contrôles d'acceptation requis avant fusion

- Un salarié non commercial crée un prospect et devient automatiquement apporteur.
- Un deuxième salarié peut s'attribuer le rôle de qualificateur ou négociateur.
- Une conversion concurrente du même prospect ne crée qu'un seul client.
- Une adresse e-mail ou un téléphone déjà présent sur un client actif bloque la conversion.
- Une politique dont les règles ne totalisent pas 100 % est refusée.
- Un calcul avant conversion est refusé.
- Les bases commande, facture intégralement réglée et montant fixe sont contrôlées côté PostgreSQL.
- Les parts de rôles absents sont normalisées et la somme des allocations est égale au total.
- Un utilisateur hors finance ne peut pas approuver ni payer, même en appelant directement le RPC.
- Un calcul rejeté ne peut pas être payé.
- Un paiement supérieur au solde, une référence dupliquée ou une répétition idempotente ne crée pas de double paiement.
- Les politiques modifiées après calcul ne changent pas les montants déjà calculés.
- Les tests RLS couvrent deux organisations et plusieurs rôles.
