# MAGNIBOX attachment quarantine worker

This worker is an opt-in, one-shot batch processor. It is not enabled by the mail-server Compose profile and does not change public mail routing.

## Required environment

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (server-side secret only; never expose to browser code)
- `MAGNIBOX_CLAMAV_HOST` (default: `clamav`)
- `MAGNIBOX_CLAMAV_PORT` (default: `3310`)

The ClamAV daemon must be reachable only on a private network. Do not publish its TCP port to the public Internet.

## Run

Compile the worker from the repository root, then run the generated JavaScript in a private worker/container that has network access to Supabase and ClamAV:

```sh
npx tsc scripts/magnibox/scan-attachments.ts scripts/magnibox/attachment-scan-core.ts \
  --target ES2022 --module commonjs --moduleResolution node --esModuleInterop \
  --skipLibCheck --outDir /tmp/magnibox-attachment-worker
node /tmp/magnibox-attachment-worker/scan-attachments.js
```

The process handles at most ten quarantined rows and exits. Schedule repeated invocations only after operational monitoring and retry limits are configured.

## Fail-closed behavior

- Claims rows with a conditional `quarantined → scanning` update.
- Downloads only from the private `magnibox-attachments` bucket.
- Verifies byte size and the stored SHA-256 digest before scanning.
- Detects supported file signatures independently of the sender-provided MIME value.
- Sends bytes to ClamAV using the INSTREAM protocol.
- Marks a file `available` only after a clean verdict and successful database update.
- Marks unsupported or infected files `rejected`; attempts to remove their private object.
- Returns transient infrastructure failures to `quarantined`; it never converts scan errors into approval.

The first implementation supports PDF, PNG, JPEG, GIF, WebP and plain UTF-8 text. Other formats (including ZIP-based Office documents) remain rejected until a dedicated structural parser and format-specific validation are implemented. The database bucket's MIME allowlist is not itself an approval decision.

## Current limitation

This is the isolated scan worker foundation. It does not yet ingest MIME attachments from Postfix, create attachment metadata, or expose downloads. The inbound bridge must continue rejecting attachments until the full ingestion-to-scan integration and end-to-end tests are merged and deployed.
