# MAGNIBOX — Conception du moteur de synchronisation IMAP

Date: 2026-11-18
Branche: feat/magnibox-mail-core-architecture-20261118

## Statut

Conception préparatoire basée sur une inspection en lecture seule du projet Supabase connecté `pmlzirobpdlzsrvtkvir`.
Aucune migration, écriture de données, modification de DNS ou déploiement n'a été effectué.

## Constat de la base connectée

Tables de messagerie présentes:
- `mgmail_internal_mailboxes`
- `mgmail_internal_messages`
- `mgmail_internal_message_reads`
- `orbit_public_identities`
- `orbit_external_messages`

La base expose aussi `accounting_event_outbox`, mais cette file appartient au domaine comptable et ne doit pas être réutilisée pour le courrier.

Aucune table IMAP / sync outbox parmi les noms examinés:
- `magnibox_sync_outbox`
- `magnibox_imap_folder_state`
- `magnibox_imap_message_map`

RLS est activé sur les tables de messagerie observées.

### Écart dépôt / base

L'historique des migrations retourné par Supabase s'arrête à `20261115220000 magnibox_atomic_draft_submission`.
La branche de code contient des migrations MAGNIBOX plus récentes (notamment fingerprint / durcissement d'envoi). La base connectée ne doit donc pas être considérée comme synchronisée avec la branche. Vérifier et résoudre cet écart avant toute migration de schéma.

## Architecture cible

Supabase reste la source canonique des messages et de leurs droits. Dovecot/IMAP est une projection synchronisée, pas une seconde source de vérité.

### A. `magnibox_sync_outbox`

Une ligne par opération à propager:
- `id uuid primary key`: identifiant d'événement stable.
- `organization_id uuid not null`.
- `aggregate_type text`: `internal_message` ou `external_message`.
- `aggregate_id uuid not null`.
- `event_type text`: `message.created`, `message.flags_changed`, `message.moved`, `message.deleted`.
- `dedupe_key text not null unique`: clé idempotente déterministe par opération métier.
- `payload jsonb not null`: données minimales de synchronisation, jamais de secret.
- `status text not null`: `pending | processing | delivered | dead`.
- `attempts integer not null default 0`, `available_at timestamptz not null default now()`.
- `locked_at timestamptz`, `locked_by text`, `lease_token uuid`.
- `last_error text`, `created_at timestamptz`, `processed_at timestamptz`.

Index de prise de tâches: (available_at, created_at) pour status=pending; index de récupération des leases expirés pour status=processing.
Le worker réclame les tâches avec `FOR UPDATE SKIP LOCKED`, un lease expirant et un jeton de fencing. Le succès ne passe à delivered qu'après confirmation de l'adaptateur. Les erreurs transitoires utilisent un backoff exponentiel avec jitter; les erreurs permanentes ou le plafond de tentatives passent à dead.

**Atomicité requise:** l'événement doit être inséré dans la même transaction que la mutation du message. Pour les écritures via RPC, ajouter l'insert à la RPC transactionnelle. Pour les autres chemins d'écriture, employer un trigger DB ciblé et testé. Ne pas compter sur un appel HTTP après commit.

### B. `magnibox_imap_folder_state`

Une ligne par dossier IMAP logique:
- `id uuid primary key`, `organization_id uuid not null`.
- `mailbox_id uuid not null` référence la boîte MAGNIBOX.
- `namespace text not null`: séparation explicite des espaces interne et Internet.
- `folder_key text not null`: identifiant logique stable du dossier, distinct du nom affiché.
- `imap_folder_name text not null`.
- `uidvalidity bigint not null`, `uidnext bigint`, `highest_modseq bigint`.
- `last_reconciled_at timestamptz`, `created_at`, `updated_at`.
- unicité sur (mailbox_id, namespace, folder_key).

UIDVALIDITY est propre à une génération de dossier. Si le serveur change UIDVALIDITY, tous les UID de cette génération sont invalidés et le worker doit reconstruire le mapping par réconciliation; ne jamais réutiliser les anciens UID.

### C. `magnibox_imap_message_map`

Une ligne par association message ↔ dossier IMAP:
- `id uuid primary key`, `organization_id uuid not null`.
- `source_type text not null`, `source_message_id uuid not null`.
- `folder_state_id uuid not null` référence `magnibox_imap_folder_state`.
- `uidvalidity bigint not null`, `imap_uid bigint`.
- `sync_version bigint not null default 1`, `imap_modseq bigint`, `imap_flags jsonb`.
- `created_at timestamptz`, `updated_at timestamptz`.
- tombstone: `deleted_at timestamptz`, `delete_event_id uuid`, `delete_confirmed_at timestamptz`.

Contraintes:
- UID unique dans un dossier et une génération: unique(folder_state_id, uidvalidity, imap_uid) lorsque imap_uid n'est pas null.
- une seule association active pour un même message/source et dossier.
- un message déplacé reçoit une suppression logique de l'association source et une nouvelle association destination. Les deux opérations sont idempotentes.

### D. Tombstones

Pas de table de tombstones distincte dans la première version: le tombstone est porté par l'association IMAP dans `magnibox_imap_message_map`. Cela conserve la trace exacte de l'ancien UID/dossier après un déplacement ou une suppression et évite un second registre à maintenir.

Un tombstone ne peut être purgé qu'après:
1. confirmation d'EXPUNGE/suppression par l'adaptateur IMAP;
2. réconciliation réussie du dossier;
3. délai de rétention opérationnel défini.

Une reprise après interruption rejoue les tombstones non confirmés; la même suppression doit être sans effet secondaire si elle est rejouée.

## Sécurité et isolation

- RLS activé sur les nouvelles tables.
- Aucun accès direct anon/authenticated aux tables de travail.
- Accès worker réservé au service backend avec rôle privilégié, secrets uniquement côté serveur.
- Chaque requête worker est limitée à l'organisation et à la boîte ciblées.
- Payload réduit au strict nécessaire; pas de corps complet ni de pièce jointe dans l'outbox.
- Le worker valide les droits et l'état du message avant projection.

## Décisions à verrouiller avant migration

1. Définir les dossiers IMAP canoniques et leur correspondance avec les dossiers personnels `mgmail_internal_folders` (qui sont des dossiers/étiquettes personnels, pas des boîtes IMAP physiques partagées).
2. Séparer les namespaces `internal` et `internet`, même si une identité Internet référence une boîte interne.
3. Choisir l'adaptateur Dovecot réel. Une écriture arbitraire dans Maildir pendant que Dovecot fonctionne n'est pas une intégration acceptable. Vérifier le backend de stockage/protocole retenu et ses garanties UID/UIDVALIDITY.
4. Résoudre l'écart de migrations entre la base connectée et la branche.
5. Créer les migrations depuis le workflow Supabase CLI requis, les tester sur une branche/dev DB, exécuter les advisors, puis proposer le déploiement séparément.

## Critères d'acceptation

- Événement métier et outbox validés/annulés dans la même transaction.
- Double livraison de l'événement sans doublon IMAP.
- Crash après prise de lease: reprise automatique après expiration.
- Erreurs temporaires réessayées; erreurs permanentes classées dead et observables.
- UID stable dans un dossier tant que UIDVALIDITY ne change pas.
- Changement UIDVALIDITY détecté et mapping reconstruit sans associer un mauvais message.
- Déplacement: tombstone source confirmé + mapping destination créé.
- Suppression rejouée plusieurs fois sans effet supplémentaire.
- Réconciliation répare les événements interrompus ou l'état IMAP divergent.
- Tests de concurrence multi-workers et d'isolation multi-tenant.
