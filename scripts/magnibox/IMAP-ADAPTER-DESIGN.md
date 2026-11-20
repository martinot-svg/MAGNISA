# MAGNIBOX IMAP adapter — implementation contract

Status: design gate only. This document does not claim that an IMAP adapter is implemented or that Dovecot is connected.

## 1. Source of truth and boundaries

- Supabase remains the canonical store for message content, mailbox membership, identities, and attachment metadata.
- `magnibox_sync_outbox` is a delivery queue, not a message store. Its payload contains identifiers only; the worker must resolve the canonical row at processing time.
- `magnibox_imap_folder_state` stores folder identity and the last observed UIDVALIDITY/UIDNEXT/MODSEQ values.
- `magnibox_imap_message_map` stores the canonical-message-to-IMAP-UID projection.
- `MagniboxImapCredentialProvider.getActive({ organizationId, mailboxId })` is the only credential retrieval boundary. Passwords must never enter the outbox, logs, browser bundles, or ordinary message rows.

## 2. Adapter composition

The concrete worker should be composed from four independently testable dependencies:

1. **Canonical message resolver** — loads a message by the exact organization, aggregate type, and aggregate ID; verifies that the target mailbox is a sender/recipient or that the internet identity belongs to that mailbox; returns a normalized message DTO and attachment handles, not public URLs.
2. **MIME composer** — builds a standards-compliant RFC 5322 message from the normalized DTO. It must use bounded streaming for attachment bytes and must not log message content.
3. **IMAP transport** — a server-only ImapFlow client configured with direct TLS, certificate verification, finite connection/command timeouts, and explicit mailbox locks for stateful operations.
4. **Projection repository** — reads/writes folder state and UID mappings using service-role access, scoped by organization and mailbox. It must reject any row whose tenant/mailbox scope differs from the claimed event.

Do not create a Supabase service-role client in browser code. Do not pass credentials through generic event payloads.

## 3. Idempotent projection protocol

A worker can lose its lease after the IMAP server has accepted APPEND but before Supabase records the UID. Retrying APPEND blindly would create duplicates.

Before enabling APPEND, implement a deterministic, opaque projection marker scoped to the organization, mailbox, and canonical message. Prefer a keyed HMAC marker with a dedicated server-side key; do not expose raw tenant IDs or credential material in the marker. Add it as a private message header and search for it before APPEND.

For every create/update event:

1. Re-read the canonical row and re-check mailbox authorization.
2. Acquire the target folder lock.
3. Read current folder UIDVALIDITY and compare it with stored state.
4. Search for the projection marker.
5. If exactly one matching message exists, reconcile its UID/flags and update the mapping.
6. If none exists, compose and APPEND once, then verify the returned UID/UIDVALIDITY and persist the mapping.
7. If multiple matches exist, stop and raise a permanent reconciliation error; never silently select one.
8. Release the lock in a `finally` path.

A changed UIDVALIDITY invalidates every UID mapping for that folder. The worker must trigger a bounded folder reconciliation; it must not assume old UIDs remain valid.

For delete events, use the stored mapping only when its UIDVALIDITY matches the live folder. Apply the configured deletion policy (mark \Deleted then EXPUNGE only if the mailbox policy explicitly permits it), and persist a tombstone/confirmation before acknowledging the outbox event.

## 4. Network and credential safety

Syntactic hostname validation is not an SSRF boundary. The worker must run in a restricted network environment with egress limited to explicitly approved IMAP endpoints. Do not rely only on a hostname check: DNS can resolve to private, loopback, link-local, or otherwise forbidden destinations, and answers can change. The pilot endpoint must be explicitly provisioned by the operator; no arbitrary user-supplied IMAP host is accepted.

- Require direct TLS and certificate validation; no plaintext fallback.
- Set connection, greeting, command, and socket timeouts.
- Never log the connection object, password, auth exchange, raw MIME, or attachment bytes.
- Close the client on every success/error path.
- Rotate/revoke credentials through the credential provider; never cache them beyond the connection lifecycle.

## 5. Failure classification

- Retryable: network reset, timeout, temporary server failure, rate limiting, Supabase transient error, lease loss.
- Permanent: tenant/mailbox mismatch, revoked/missing credential, unsupported mailbox policy, invalid canonical message, malformed projection marker, conflicting duplicate markers.
- Do not acknowledge an event until the IMAP effect and its mapping/reconciliation state are durably confirmed.
- If IMAP succeeds but the database write fails, retry by searching the marker; do not APPEND blindly.
- Error messages persisted to the outbox must be sanitized and must not contain credentials or message content.

## 6. Pilot acceptance tests

The adapter is not ready until an isolated, dedicated Dovecot test mailbox proves:

1. Direct TLS succeeds with certificate verification and rejects an untrusted certificate.
2. A create event APPENDs exactly one message and records UID + UIDVALIDITY.
3. Replaying the same event after simulated lease loss does not create a second message.
4. A process crash after APPEND but before mapping persistence is recovered by marker search.
5. A changed UIDVALIDITY causes safe reconciliation rather than stale-UID operations.
6. Update, flags, move, and delete follow explicit mailbox policies without feedback loops.
7. Revoked credentials and cross-tenant mailbox IDs are rejected.
8. Timeouts, server disconnects, and Supabase failures retry without losing canonical data.
9. Logs and persisted errors contain no password, auth material, message body, or attachment content.

## 7. Dependency installation gate

The repository currently has no `imapflow` entry in `package-lock.json`. Install the exact package version in a real Node 22/npm 10.9.2 checkout, then commit both `package.json` and `package-lock.json` together. Do not hand-edit the lockfile or add only a package manifest entry.

After installation, run `npm ci`, `npm test`, `npm run lint`, and the production build. Only then implement the concrete ImapFlow transport and its isolated Dovecot integration tests.

## Current status

The outbox, credential vault, cryptographic envelope, and transport-independent worker are implemented and covered by CI. This document is the implementation contract for the next adapter stage; it is not evidence of a live IMAP synchronization service. No production deployment, DNS/MX change, or public mail transport is enabled by this work.
