# MAGNIBOX — écart d'historique Supabase avant migration IMAP

Date de vérification: 2026-11-18
Projet Supabase connecté: `pmlzirobpdlzsrvtkvir`
Branche: `feat/magnibox-mail-core-architecture-20261118`

## Résultat de la lecture seule

La liste des migrations réellement enregistrées dans Supabase se termine à:
`20261115220000 magnibox_atomic_draft_submission`.

La branche contient des migrations ultérieures, notamment:
- `20261117100000_mgmail_internal_idempotent_send.sql`
- `20261117200000_magnibox_outbound_request_fingerprint.sql`
- `20261118110000_magnibox_draft_recipient_fk.sql`

Les colonnes `client_request_id` sur `mgmail_internal_messages` et `request_fingerprint` sur `orbit_external_messages` ne figurent pas dans l'introspection réelle. Cela concorde avec l'absence de ces migrations dans l'historique Supabase.

Le fichier `production-pending-allowlist.txt` contient `20261117100000`, mais l'historique connecté ne l'indique pas comme appliquée. Les migrations postérieures ne sont pas toutes dans cet allowlist. Le marqueur `production-release-approved.txt` décrit un ancien lot de production, pas une approbation des migrations MAGNIBOX de novembre 17–18.

## Décision de sécurité

Aucune migration n'a été appliquée. Ne pas:
- marquer manuellement les migrations comme appliquées;
- rejouer un lot de migrations complet sans préflight;
- contourner l'allowlist de production;
- appliquer directement le SQL de synchronisation sur la base connectée.

La divergence doit être réconciliée migration par migration, avec comparaison du SQL, inspection des objets existants et tests sur une base de développement/branche.

## Conséquence pour le chantier IMAP

Le SQL de conception de l'outbox, du claim/ack/fail avec lease fencing, des états de dossier, du mapping UID/UIDVALIDITY et des tombstones est préparé dans:
`infra/magnibox-mail/sql/IMAP-SYNC-ENGINE-PROPOSAL.sql`.

Ce fichier est une proposition non exécutable par le pipeline de migrations et n'est pas une migration déployée. Les déclencheurs couvrent les insertions/modifications/suppressions des tables de messages internes et Internet. Les dossiers personnels et les états de lecture par utilisateur sont volontairement exclus tant que leur projection IMAP n'est pas décidée.

## Prochaines validations

1. Comparer toutes les migrations du dépôt après `20261115220000` à la base distante, pas uniquement les trois exemples.
2. Examiner les dépendances et effets de chaque migration absente, et comparer les objets réels.
3. Faire un replay complet sur une base de test fraîche et un replay de rattrapage sur une copie de schéma.
4. Obtenir une allowlist de release explicite pour le lot visé.
5. Appliquer les migrations de prérequis selon la procédure approuvée, puis reprendre l'outbox IMAP.
