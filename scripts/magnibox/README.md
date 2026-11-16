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
