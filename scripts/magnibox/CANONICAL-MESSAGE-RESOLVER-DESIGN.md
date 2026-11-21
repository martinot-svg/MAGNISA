# MAGNIBOX canonical message resolver — implementation gate

Status: schema-backed design contract. This is not a database resolver implementation and does not claim that an IMAP worker is connected.

## 1. Purpose

The resolver is the only boundary between a claimed `magnibox_sync_outbox` event and canonical mail data. It must load current source rows from Supabase at processing time; it must never trust body, recipients, identity, mailbox, or attachment metadata copied into an outbox payload.

Input scope is the tuple:

- `organization_id` from the claimed event;
- `aggregate_type` (`internal_message` or `external_message`);
- `aggregate_id` from the claimed event;
- exact target mailbox ID selected by the worker;
- exact namespace (`internal` or `internet`), plus identity ID for Internet mail.

A mismatch is a permanent authorization/consistency error. Do not fall back to another organization, mailbox, identity, or message.

## 2. Canonical source schemas verified in repository migrations

### Internal MAGNIBOX

Source: `mgmail_internal_messages`.

Canonical fields available in the inspected migrations:

- `id`, `organization_id`;
- `sender_mailbox_id`, `recipient_mailbox_id`;
- `subject`, `body_text`, `created_at`.

The mailbox is `mgmail_internal_mailboxes` with `local_part`, `owner_user_id`, `display_name`, `is_active`, `can_read`, and `can_send`. Shared access is represented by `mgmail_internal_mailbox_grants` (`can_read`, `can_send`, `is_active`). Individual read state is stored in `mgmail_internal_message_reads`, not as one mailbox-wide truth.

**Important format limitation:** internal messages currently contain plain text subject/body only. They do not have canonical RFC Message-ID, raw headers, HTML body, MIME tree, or canonical attachments. The resolver must not fabricate those fields or claim full MIME fidelity.

### Internet MAGNIBOX

Source: `orbit_external_messages`.

Canonical fields include:

- `id`, `organization_id`, `identity_id`;
- `direction`, `status`;
- `from_email`, `to_emails`, `subject`, `body_text`;
- `provider_email_id`, `created_by`, `created_at`, `updated_at`.

The identity is `orbit_public_identities`, which binds `organization_id`, `mailbox_id`, `email_address`, `status`, `receive_enabled`, and provider metadata. Additional user access is in `orbit_external_mailbox_access`. The internal mailbox access and external identity access are separate gates.

Attachments are represented by `orbit_external_message_attachments` metadata and private objects in the `magnibox-attachments` bucket. Only rows with `scan_status = 'available'` may be passed to a future MIME composer. Never expose public object URLs. The resolver returns opaque storage handles and verified metadata; a separate bounded streaming reader retrieves bytes server-side.

## 3. Required authorization and consistency checks

All checks must be explicit in the service-role repository because service-role queries bypass ordinary user RLS. The worker is not acting as an end-user, so it must not infer authorization from an RLS bypass.

### Internal message target

For target mailbox `M`, load by all of:

`id = aggregate_id AND organization_id = event.organization_id`.

Then require:

1. event aggregate type is `internal_message`;
2. namespace is `internal`, with no Internet identity;
3. target mailbox belongs to the same organization and is active;
4. target mailbox ID equals exactly `sender_mailbox_id` or `recipient_mailbox_id`;
5. the message row and mailbox row are still present at resolution time.

The current data model does not make per-user `\Seen` semantics safe for a shared mailbox: `mgmail_internal_message_reads` is user-specific. Do not project a single user's read state as a mailbox-wide IMAP flag. Shared-mailbox IMAP account ownership, `\Seen` semantics, and personal-folder projection require an explicit product policy before implementing flag/folder synchronization.

### Internet message target

Load the message by all of:

`id = aggregate_id AND organization_id = event.organization_id AND identity_id = requested_identity_id`.

Then require:

1. event aggregate type is `external_message`;
2. namespace is `internet`;
3. identity belongs to the same organization and is linked to the exact target mailbox;
4. identity status and `receive_enabled` are checked for incoming delivery;
5. outgoing projection status is checked against an explicit delivery policy; do not assume every queued/sending/failed row belongs in an IMAP Sent folder;
6. every attachment metadata row belongs to the exact message and organization, and only `available` attachments are eligible for content retrieval.

External mailbox access is distinct from internal mailbox access. If the worker is projecting a service mailbox rather than a user's view, the service identity must be explicitly bound to that mailbox/identity in trusted configuration; do not use a browser user's grants as a substitute for a mailbox ownership rule.

## 4. Normalized resolver DTO

The resolver should return a discriminated union with only canonical, bounded fields:

- common: organization ID, source type/ID, target mailbox ID, namespace, folder intent, subject, plain-text body, canonical timestamp, and an opaque idempotency marker input;
- internal: sender and recipient mailbox IDs plus resolved internal address/display metadata;
- Internet: identity ID, RFC sender address, bounded recipient address list, direction, provider message ID when present, and attachment handles with scan status/size/digest metadata.

Do not include credentials, service-role keys, signed/public URLs, raw storage bytes, arbitrary provider payloads, or outbox error strings in the DTO.

The DTO is not MIME. A separate composer must generate validated RFC 5322 headers and stream approved attachments under strict total-size and per-file limits.

## 5. Event handling rules

- Re-read canonical data for every event; do not replay stale message bodies from the outbox.
- Treat a missing source row on a delete event differently from a missing source row on create/update. Delete must use the existing durable mapping/tombstone and must not attempt to reconstruct deleted content.
- Re-check target mailbox/identity scope immediately before IMAP I/O.
- Never interpret a generic `message.updated` as permission to change mailbox membership, folder, flags, or recipients.
- Ignore or explicitly reject event types whose semantics are not implemented. In particular, `message.flags_changed`, `message.moved`, and personal label events must not be acknowledged as successful no-ops.
- Sanitize permanent errors; do not persist subject, body, recipients, attachment names, or secret material in outbox diagnostics.

## 6. Blocking product/architecture decisions before implementation

1. **Shared internal mailbox model:** does one Dovecot account represent the shared mailbox for all users, or does each user receive a separate IMAP projection? This determines `\\Seen`, personal folders, grants, and mapping cardinality. Current per-mailbox mapping alone cannot represent per-user read state.
2. **Internet outgoing projection:** define which statuses enter IMAP Sent and when. A `queued` message is not proof that SMTP accepted it; a `failed` message should not silently appear as successfully sent.
3. **Internal address format:** use the private MAGNIBOX namespace `<local_part>@<organization-slug>.magnibox` for new internal message serialization. This suffix is not a public Internet domain and must never be routed to external SMTP. The legacy database object names (`mgmail_internal_*`) remain unchanged until a separate, fully tested schema migration is prepared.
4. **Deletion and retention:** define whether source deletion removes IMAP copies, tombstones them, or retains them under a mailbox policy. Never EXPUNGE by default.
5. **MIME completeness:** decide whether internal messages remain text-only or gain canonical Message-ID/date/HTML/attachment fields before claiming standards-compliant round-trip fidelity.

## 7. Implementation sequence after decisions

1. Add a pure resolver core with injected repository interfaces and strict DTO validation.
2. Add a server-only Supabase repository that queries by organization + source ID + mailbox/identity scope and verifies every relation explicitly.
3. Add contract tests for cross-tenant IDs, wrong mailbox, inactive mailbox, suspended identity, disabled receiving, unavailable attachments, and source deletion.
4. Add bounded private attachment streaming only after metadata checks pass.
5. Implement MIME composition and marker generation as separate modules.
6. Only then connect the resolver to the concrete IMAP adapter and isolated Dovecot pilot.

## 8. Evidence boundary

The schema facts above were read from repository migrations and the checked-in schema inventory. They are not a fresh introspection of the connected production database. No production schema, credentials, Dovecot account, or external mail transport was changed by this design document.
