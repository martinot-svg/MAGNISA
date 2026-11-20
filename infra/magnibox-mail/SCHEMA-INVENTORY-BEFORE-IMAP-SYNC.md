# MAGNIBOX — inventaire du schéma avant synchronisation IMAP

Date de l'inventaire : 2026-11-18  
Branche inspectée : `feat/magnibox-mail-core-architecture-20261118`  
Périmètre : migrations SQL et routes applicatives présentes dans cette branche. Cet inventaire décrit le schéma du dépôt ; il ne constitue pas une introspection directe de la base de production.

## 1. Conclusion d'architecture

Le dépôt possède déjà deux modèles de courrier distincts :

1. **magnibox interne** : `magnibox_internal_mailboxes` et `magnibox_internal_messages`, avec droits, lectures individuelles, brouillons et dossiers personnels.
2. **Courrier Internet MAGNIBOX** : `orbit_public_identities`, `orbit_external_messages` et `orbit_external_message_attachments`, avec identité publique, état du transport, idempotence et pièces jointes privées.

Il n'existe pas, dans les migrations inspectées, de table d'outbox de synchronisation, de correspondance UID IMAP, de `UIDVALIDITY`, de tombstone IMAP ou de journal de synchronisation. Les deux modèles existants ne doivent donc pas être recréés. Les futures tables doivent être strictement techniques et référencer les lignes existantes.

## 2. Modèle magnibox interne

### `magnibox_internal_namespaces`
- `organization_id` : PK et FK vers `organizations`, suppression en cascade.
- `slug` : obligatoire, unique, format slug minuscule, longueur 2–45.
- `created_at`.
- RLS activée ; lecture membre d'organisation, création permission `users.manage`.

### `magnibox_internal_mailboxes`
- `id` UUID PK.
- `organization_id` FK vers le namespace.
- `local_part` : obligatoire, format contrôlé, unique avec `organization_id`.
- `owner_user_id` nullable, FK `auth.users`.
- `display_name`, `is_active`, `can_read`, `can_send`, `created_at`.
- Index organisation/propriétaire.
- Index unique composite `(id, organization_id)` ajouté pour les FK tenant-safe.
- RLS activée ; suspension automatique à la sortie d'un membre. La désactivation de la boîte suspend aussi l'identité Internet liée.

### `magnibox_internal_messages`
Colonnes initiales :
- `id` UUID PK ; `organization_id`.
- `sender_mailbox_id`, `recipient_mailbox_id`.
- `subject` (1–180 caractères), `body_text` (1–50 000 caractères), `created_at`.

Extensions identifiées :
- `read_at` nullable : indicateur historique simple de lecture.
- `client_request_id` nullable : clé d'idempotence d'envoi.
- Index unique partiel `(organization_id, sender_mailbox_id, client_request_id)` lorsque la clé n'est pas nulle.
- RPC `magnibox_send_internal_message(...)` SECURITY DEFINER : contrôle les droits et rend l'envoi idempotent. Les clients authentifiés n'ont pas de droit INSERT direct sur la table.
- RLS activée ; visibilité fondée sur les accès aux boîtes source/destination.

**Limites pour IMAP :** ce modèle est un message interne simple, pas un objet MIME complet. Il n'a pas de `Message-ID` RFC, d'en-têtes bruts, de date de réception séparée, de corps HTML, de structure MIME ni de statut de brouillon sur la ligne envoyée. Ne pas prétendre qu'il représente déjà un message Internet complet.

### `magnibox_internal_mailbox_grants`
- PK `(organization_id, mailbox_id, user_id)`.
- Droits individuels `can_read`, `can_send`, `is_active`, `created_at`.
- FK composite vers la boîte et FK vers l'utilisateur.
- RLS activée ; révocation à la suspension/suppression du membre.

### `magnibox_internal_message_reads`
- PK `(message_id, user_id)`.
- `organization_id`, `message_id`, `user_id`, `read_at`.
- RLS activée ; état de lecture par utilisateur, important pour les boîtes partagées.

### `magnibox_internal_drafts`
- `id`, `organization_id`, `sender_mailbox_id`, `recipient_mailbox_id` nullable, `created_by`, `subject`, `body_text`, `created_at`, `updated_at`.
- Brouillons privés à l'auteur ; RPC d'envoi qui crée le message puis supprime le brouillon de manière transactionnelle.
- RLS activée.

### `magnibox_internal_folders` et `magnibox_internal_message_folders`
- Dossiers personnalisés par utilisateur, nom unique insensible à la casse dans l'organisation.
- Association d'un message à un dossier via `(folder_id, message_id, user_id)`.
- Les dossiers sont des vues personnelles/étiquettes, pas des boîtes IMAP globales ni des copies physiques.
- RLS activée ; FK composites garantissant organisation et propriétaire.

## 3. Modèle courrier Internet MAGNIBOX

### `magnibox_domain_requests` et `magnibox_public_address_requests`
- Demandes de domaine et d'adresse liées à une boîte interne existante.
- Les demandes ne constituent pas à elles seules une activation SMTP/IMAP.
- Statuts de vérification/approbation contrôlés ; les changements de statut suspendent les identités publiques liées.

### `orbit_public_identities`
- `id`, `organization_id`, `domain_request_id`, `address_request_id`, `mailbox_id`.
- `domain_name`, `local_part`, `email_address` généré.
- `provider` (resend/smtp/microsoft_graph), références et date de vérification fournisseur.
- `status` (pending/active/suspended), `receive_enabled`, timestamps.
- FK composites vers la boîte interne, la demande de domaine et la demande d'adresse ; unicité de l'adresse.
- Activation conditionnée par domaine vérifié, adresse approuvée, preuve fournisseur et boîte active.
- RLS activée.

### `orbit_external_mailbox_access`
- Droits externes par utilisateur et identité : `can_read`, `can_send`, `is_active`.
- PK `(organization_id, identity_id, user_id)`, FK tenant-safe.
- Les autorisations Internet s'ajoutent aux autorisations internes ; elles ne les remplacent pas.

### `orbit_external_messages`
Colonnes définies dans la migration initiale :
- `id` UUID PK, `organization_id`, `identity_id`.
- `direction` : incoming/outgoing.
- `status` : incoming reçu ; outgoing avec états de transport.
- `from_email`, `to_emails` (tableau), `subject`, `body_text`.
- `provider_email_id`, `request_key`, `created_by`, `last_error`, `created_at`, `updated_at`.

Extensions :
- Le statut `draft` est admis pour les messages sortants.
- `request_fingerprint` SHA-256 lie la clé d'idempotence au contenu et aux métadonnées des pièces jointes.
- Unicité partielle par identité/direction/ID fournisseur et par identité/clé de requête.
- FK `(identity_id, organization_id)` ; unicité `(id, organization_id)` pour les pièces jointes.
- RLS activée ; les écritures transport passent par des opérations serveur contrôlées.

### `orbit_external_message_attachments`
- `id`, `organization_id`, `message_id`, `storage_path`, `display_name`, `detected_mime_type`, `byte_size`, `sha256`.
- `scan_status` (quarantined/scanning/available/rejected), `scan_completed_at`, `created_at`.
- FK composite vers `orbit_external_messages(id, organization_id)`.
- Stockage privé `magnibox-attachments`, sans accès direct navigateur aux objets en quarantaine.
- Limites et contrôles de scan appliqués par trigger/politiques.

## 4. Routes et flux constatés

- `POST /api/internal/magnibox/inbound` : reçoit une enveloppe signée, vérifie les identités et boîtes actives, écrit une ligne `orbit_external_messages` entrante par destinataire et stocke les pièces jointes en quarantaine.
- Le rejeu entrant compare l'enveloppe et les métadonnées des pièces jointes ; un identifiant fournisseur réutilisé avec un contenu différent est rejeté.
- `GET /api/magnibox/internet/messages` : lit les messages Internet existants et les pièces jointes disponibles.
- Les tables magnibox internes ont leur propre RPC d'envoi, leurs dossiers et leurs lectures individuelles.
- Aucun flux vérifié ne relie actuellement ces écritures Supabase à des UID/flags/folders Dovecot. La réussite IMAPS seule ne prouve pas cette synchronisation.

## 5. Conséquences : ce qu'il ne faut PAS créer

Ne pas créer :
- une deuxième table de messages pour recopier `magnibox_internal_messages` ;
- une deuxième table de boîtes pour recopier `magnibox_internal_mailboxes` ;
- une nouvelle table de pièces jointes qui ferait doublon avec `orbit_external_message_attachments` ;
- une table de dossiers générique qui dupliquerait les dossiers personnels existants ;
- un second mécanisme d'idempotence qui ignore `client_request_id`, `request_key` ou `provider_email_id`.

Ne pas utiliser `read_at` seul comme état IMAP partagé : les boîtes partagées ont déjà `magnibox_internal_message_reads` par utilisateur.

## 6. Objets techniques potentiellement nécessaires — à confirmer avant migration

Les seules données nouvelles qui semblent justifiées sont des **métadonnées de projection IMAP** :

1. **Mapping message/dossier IMAP** : source type + source UUID + boîte logique + dossier IMAP + UID + UIDVALIDITY. L'identifiant de source doit être unique dans le contexte d'une boîte IMAP.
2. **État de boîte IMAP** : boîte logique, nom/identifiant de dossier, UIDVALIDITY, UIDNEXT ou watermark équivalent, date de dernière réconciliation.
3. **Outbox transactionnelle** : événements issus des mutations de source, avec identifiant stable, version, état pending/leased/done/dead, nombre de tentatives, prochaine tentative, erreur expurgée et horodatages.
4. **Tombstones** : suppressions IMAP logiques nécessaires pour propager EXPUNGE sans perdre l'historique ni réutiliser un UID.

Décision encore ouverte : le backend IMAP doit gérer correctement les commandes APPEND, FETCH, STORE, MOVE/COPY, EXPUNGE et les drapeaux par utilisateur. Les dossiers personnels et lectures individuelles existants imposent une projection IMAP par utilisateur ou une politique explicite de boîte partagée ; un simple mapping global par message serait incorrect.

**Point de conception bloquant avant migration :** choisir si IMAP expose les boîtes magnibox internes, les identités Internet, ou les deux comme namespaces distincts. Le modèle externe référence déjà une boîte interne via `orbit_public_identities.mailbox_id`, mais cela ne prouve pas qu'il faille fusionner les deux flux dans un même dossier IMAP.

## 7. Vérifications et limites de cet inventaire

- Inventaire dérivé des migrations et routes de la branche indiquée.
- Le contrat SQL `supabase/tests/magnibox-internal-schema-contract.sql` confirme les huit tables magnibox internes, les politiques RLS et les RPC attendues lorsque le test est exécuté sur une base.
- Aucun accès en lecture à `pg_catalog` de la base distante n'a été exécuté pendant cet inventaire ; les colonnes, index, policies et triggers effectifs de production doivent être comparés au schéma réel avant d'appliquer une migration.
- Aucune migration de synchronisation n'a été créée ni appliquée par ce document.
