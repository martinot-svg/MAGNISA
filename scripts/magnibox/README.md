# MAGNIBOX attachment quarantine worker

The attachment worker scans metadata rows that have already been created by the signed inbound bridge and API. It does not parse Postfix MIME itself: the Postfix bridge extracts bounded attachments, the internal MAGNIBOX inbound API stores each object in the private `magnibox-attachments` bucket and creates a `quarantined` metadata row, and this worker performs the trusted scan before an object can become available.

## Compose operation

The `attachment-worker` service is defined in `infra/magnibox-mail/compose.yaml` without a Compose profile. It is therefore started by the normal Compose deployment alongside the mailserver. It shares the mailserver network namespace to reach ClamAV at `127.0.0.1:3310`, runs with a read-only root filesystem, drops Linux capabilities, and polls at 60-second intervals. Each invocation handles at most ten quarantined rows.

Required host-only `.env` settings are:

- `MAGNIBOX_WORKER_SUPABASE_URL`
- `MAGNIBOX_WORKER_SERVICE_ROLE_KEY` (server-side secret only; never expose to browser code)

The Compose service maps these to `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` inside the worker container. The variable name `NEXT_PUBLIC_SUPABASE_URL` is used by the Supabase client for the project URL; it is not a secret. The service-role key must remain server-side.

The ClamAV endpoint is private to the shared container network namespace:

- `MAGNIBOX_CLAMAV_HOST` (Compose default: `127.0.0.1`)
- `MAGNIBOX_CLAMAV_PORT` (Compose default: `3310`)

Never publish ClamAV TCP/3310 to the public Internet. The Compose worker is part of the staged pilot scaffold; do not start or expose the MTA publicly until the operator prerequisites and approval gates in `infra/magnibox-mail/README.md` are satisfied.

## Manual one-shot run

For isolated development or diagnosis, compile the worker from the repository root and run the generated JavaScript in a private environment that can reach Supabase and ClamAV:

```sh
npx tsc scripts/magnibox/scan-attachments.ts scripts/magnibox/attachment-scan-core.ts \
  --target ES2022 --module commonjs --moduleResolution node --esModuleInterop \
  --skipLibCheck --outDir /tmp/magnibox-attachment-worker
node /tmp/magnibox-attachment-worker/scan-attachments.js
```

## Fail-closed behavior

- Claims rows with a conditional `quarantined → scanning` update and a fresh lease token.
- Downloads only from the private `magnibox-attachments` bucket.
- Verifies byte size and the stored SHA-256 digest before scanning.
- Detects supported file signatures independently of the sender-provided MIME value.
- Sends bytes to ClamAV using the INSTREAM protocol.
- Marks a file `available` only after a clean verdict and a successful, lease-fenced database update.
- Marks unsupported or infected files `rejected`; attempts to remove their private object.
- Returns transient infrastructure failures to `quarantined`; it never converts scan errors into approval.
- Recovers stale scan leases and rejects rows whose retry budget is exhausted.

The first implementation supports PDF, PNG, JPEG, GIF, WebP and plain UTF-8 text. Other formats (including ZIP-based Office documents), unknown formats, empty files and malformed content remain rejected until dedicated structural validation is implemented. The database bucket MIME allowlist is not itself an approval decision.

## Integration boundary and operational limitation

The inbound bridge and API already implement attachment extraction, bounded payload validation, private object storage and `quarantined` metadata creation. The worker then performs scanning and controls the transition to `available` or `rejected`. This describes the code path; it is not evidence that a real MTA, ClamAV daemon, Supabase project or external SMTP route has been provisioned or passed an end-to-end operational test.

Before enabling the Postfix inbound transport or customer-facing attachment access, run an isolated pilot that proves all of the following on the deployed host:

1. A clean supported attachment is received, stored as `quarantined`, scanned, and becomes `available`.
2. An infected test attachment is rejected and its private object is removed.
3. Unsupported and malformed files remain unavailable.
4. A ClamAV outage or timeout leaves the object quarantined for retry; it never becomes available.
5. Duplicate inbound deliveries and concurrent/stale worker leases cannot create an unsafe state or overwrite a newer verdict.
6. Authenticated downloads succeed only for metadata rows visible through the user's RLS access.

Until those tests and the operator approval gates pass, keep the public MTA transport and customer MX changes disabled. No MX record is modified automatically by this worker.

## IMAP synchronization core (new, not yet connected to Dovecot)

`imap-sync-core.ts` provides the transport-independent batch engine for the future IMAP sync worker:

- claims a bounded batch with a worker identity and lease duration;
- applies each event through an injected IMAP adapter;
- acknowledges only with the original lease token;
- schedules transient errors using capped exponential backoff with full jitter;
- routes explicitly permanent errors to the dead-letter state;
- records lease loss rather than acknowledging a newer worker's claim.

The adapter contract explicitly requires idempotency by outbox event ID and reconciliation against the canonical Supabase row and mapping. This is necessary because an IMAP operation may succeed just before the worker loses its lease or process.

Unit tests are in `imap-sync-core.test.ts` and are picked up by the repository's Vitest suite.

`imap-sync-supabase-repository.ts` implements the worker repository contract against the three lease-fenced RPCs (`magnibox_claim_sync_events`, `magnibox_complete_sync_event`, `magnibox_fail_sync_event`). It validates returned rows and scalar results, passes the original lease token on acknowledgements, and treats Supabase RPC errors as retryable infrastructure failures. Its contract tests are in `imap-sync-supabase-repository.test.ts`.

The SQL implementation is now a real migration in this branch: `supabase/migrations/20261119120000_magnibox_imap_sync_engine.sql`. Its clean-database replay, schema contract, and runtime lease/retry/dead-letter tests pass in GitHub Actions on commit `771716716117621d9bdce2015645d63ca5aa381f`. The migration has **not** been applied to the connected Supabase project or production. The earlier `infra/magnibox-mail/sql/IMAP-SYNC-ENGINE-PROPOSAL.sql` is superseded documentation and must not be applied.

**Not implemented yet:** the concrete IMAPFlow/Dovecot adapter, MIME serialization and parsing policy, per-mailbox credential provisioning, mailbox/folder reconciliation loop, and live Dovecot integration tests covering UIDVALIDITY changes, UID mapping, flags, reconnects, duplicate events, lease expiry, and crash/replay behavior.

### Required blocker before a real IMAP adapter

The current MTA scaffold uses Docker Mailserver's file-based account provisioner (`ACCOUNT_PROVISIONER=FILE`) and a manually created technical pilot account. It does not yet provide a secure, tenant-aware mapping from a MAGNIBOX mailbox/identity to Dovecot IMAP credentials. The application mailbox tables are not proof that a matching Dovecot account exists.

Do not put mailbox passwords in the outbox payload, ordinary application rows, source control, browser variables, or worker logs. Before implementing the concrete adapter, define and test a server-only credential provider with encrypted-at-rest storage or a dedicated secrets manager, tenant/mailbox binding, rotation/revocation, and least-privilege access. Then implement a pilot-only IMAP adapter against a dedicated test mailbox and prove APPEND/UID mapping/replay before enabling any general mailbox synchronization.

Until that credential boundary and the live Dovecot tests exist, the core worker and Supabase repository are tested building blocks—not an operational IMAP synchronization service.


## IMAP credential provider boundary (contract only)

`imap-credential-provider.ts` defines the server-side contract for tenant/mailbox-scoped Dovecot credentials, rotation, revocation, and connection-setting validation. The contract deliberately has no Supabase-table or plaintext-storage implementation. A production provider must be backed by an encrypted secret store/KMS, enforce exact organization/mailbox scope, and prevent revoked credentials from being returned. Its tests verify validation and that errors do not echo password values.

This is **not yet a live credential vault**: no credential is stored or provisioned by this change, and no IMAP connection is enabled. The next implementation gate is to select and provision the secret-store backend, then implement and integration-test this interface before adding IMAPFlow.

### Encrypted credential envelope (cryptographic primitive)

`imap-credential-crypto.ts` provides AES-256-GCM authenticated encryption for IMAP credentials. Organization and mailbox IDs are authenticated as associated data, so ciphertext copied between tenants or mailboxes cannot be decrypted under another scope. Each encryption uses a fresh 96-bit nonce. Decryption fails closed and returns generic errors that do not include secret values.

Server runtime configuration:
- `MAGNIBOX_IMAP_ACTIVE_KEY_ID`: identifier for the key used for new encryptions.
- `MAGNIBOX_IMAP_CREDENTIALS_KEYS`: server-only JSON object mapping key IDs to Base64-encoded 32-byte keys. Retain old keys while ciphertext encrypted with them exists; changing the active key supports staged rotation.

Keep both variables out of browser-prefixed names, source control, logs, and client bundles. Provision them as Vercel Secret environment variables or equivalent host secrets. Never paste key material into chat or GitHub.

This is the encryption primitive and key-loading contract only. It does not yet persist envelopes, implement a Supabase repository, or prove live key provisioning/rotation. A service-role-only store and audit controls are still required before creating credential records.

## Supabase encrypted IMAP credential vault (implementation scaffold)

`imap-credential-supabase-provider.ts` binds the credential-provider contract to the dedicated vault RPCs. It encrypts credentials before persistence, checks the returned organization/mailbox scope before decryption, and returns generic errors without database details. It must be constructed only with a server-side service-role Supabase client and a server-loaded AES-256-GCM keyring. The browser client must never call these RPCs.

The migrations `20261119130000_magnibox_imap_credential_vault.sql` and `20261119140000_magnibox_imap_credential_vault_rpc.sql` create the ciphertext-only store and service-role-only RPC boundary. Rotation is serialized per organization/mailbox, revokes the previous active version, and assigns a monotonically increasing version. Repeated idempotency keys return the original operation result. `magnibox-imap-credential-vault-contract.sql` is executed during clean-database CI replay.

This is not yet a provisioned production vault: no service-role client, encryption key, Dovecot account mapping, or live IMAP credentials have been configured. Do not apply these migrations to production until the full replay and security contracts pass and an operator explicitly approves the migration.


## Canonical internal message resolver (first pilot slice)

`canonical-internal-message-resolver.ts` now implements a transport-independent resolver core for **individual, active MGMail mailboxes only**. It reloads the canonical internal message using organization + message ID, verifies that the requested target mailbox is a participant, checks that the target mailbox is active/readable and individually owned, rejects active shared-mailbox grants, and resolves peer mailbox metadata within the same organization.

The resolver deliberately ignores `event.payload` for message content and mailbox scope. It supports create/update events only. Deletes must be processed from the durable IMAP mapping/tombstone, because the canonical source row may already have been deleted. Unsupported source/event types fail permanently rather than being acknowledged as successful no-ops.

Contract tests in `canonical-internal-message-resolver.test.ts` cover canonical-content reload, untrusted outbox payloads, cross-organization rows, non-participant mailbox IDs, inactive/unreadable targets, shared-grant exclusion, unsupported events and cross-organization peer mailboxes.

This is the pure resolver core and its test contract, **not yet the concrete Supabase query adapter**. The next implementation step is to bind its repository interface to a server-only Supabase service client and add isolated database integration tests. No MIME address convention is invented here; the internal namespace/domain policy and full MIME serialization remain separate decisions. No production data or IMAP service was changed by this addition.


### Supabase repository binding

`canonical-internal-message-supabase-repository.ts` binds the pure resolver interface to the exact source tables. Message and mailbox lookups always include both `organization_id` and the requested row ID. The shared-grant query is scoped by organization, mailbox, and `is_active = true`. Database errors are converted to generic retryable sync errors; malformed rows fail permanently without copying row content into diagnostics.

Its adapter contract tests verify query scoping, active-grant detection, missing grants, generic database errors and malformed rows. The repository must be constructed only in a server-side worker with a service-role client; it is not a browser data-access layer.


### Internal-message participant fan-out

A single internal-message outbox event represents the canonical message, while IMAP projection is mailbox-specific. `resolveMagniboxInternalMessageForParticipants` therefore reloads the canonical row and resolves one projection for each distinct sender/recipient mailbox ID. The participant IDs are taken only from the organization-scoped canonical row, never from the outbox payload. Self-addressed messages are deduplicated to one mailbox projection.

This is still a resolver-level fan-out contract: it does not yet write to IMAP, claim per-mailbox credentials, or establish delivery semantics for a multi-mailbox event. The worker adapter must treat the event as complete only after every required participant projection has been applied idempotently, or after a durable per-mailbox child-work model is introduced.
