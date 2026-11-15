# MAGNIBOX — self-hosted MTA pilot scaffold

This directory contains an **un-deployed infrastructure scaffold** for a dedicated MAGNIBOX mail host. It uses Docker Mailserver as self-hosted software (Postfix, Dovecot and filtering components); it is not an email SaaS provider and does not replace the MAGNIBOX application.

> This scaffold is not a production-ready mail service by itself. Do not point customer MX records at it or enable `MAGNIBOX_EXTERNAL_MAIL_ENABLED` until the infrastructure, DNS, anti-abuse controls and end-to-end tests have been independently verified.

## What this first stage provides

- SMTP reception on TCP/25 at the MTA host.
- Authenticated SMTP submission on TCP/587 for the MAGNIBOX application.
- IMAPS on TCP/993 for controlled diagnostics or future client compatibility.
- Persistent mail, state, configuration and log directories.
- Rspamd filtering, ClamAV scanning, DKIM capability and Fail2ban.
- Explicit message/mailbox size limits and modern TLS for authenticated services.

It does **not** yet connect Dovecot mailboxes to the MAGNISA/Supabase inbox. The signed inbound API in the application still needs a tested Postfix-to-MAGNIBOX bridge. This scaffold also does not provision customer domains or their sender identities automatically.

## Requirements before use

1. A dedicated Linux host with a stable public IPv4 address and an operator-controlled reverse-DNS/PTR record.
2. Written confirmation from the hosting provider that TCP/25 is permitted in both directions.
3. A public FQDN such as `mail.example.net`, with matching A record and PTR/rDNS.
4. A valid TLS certificate whose SAN contains the MTA FQDN.
5. Sufficient memory and disk for the mail queue, persistent mail, logs and antivirus definitions. ClamAV can require substantial memory; size the host accordingly.
6. Firewall rules that expose only TCP/25, TCP/587 and TCP/993 as required. Never expose Docker's management socket or the Rspamd control interface publicly.
7. Encrypted off-host backups and a tested restore procedure.
8. An abuse mailbox, postmaster contact, rate limits, monitoring and an incident-response process.

Do not use a server behind carrier-grade NAT or a residential IP for public mail delivery. Do not proceed if outbound TCP/25 is blocked.

## Prepare the host

Run these commands from this directory on the dedicated Linux host:

```sh
cp mailserver.env.example mailserver.env
mkdir -p docker-data/mail-data docker-data/mail-state docker-data/logs docker-data/config
chmod 700 docker-data
```

Create a host directory for the certificate and private key, then set its path in the host's uncommitted `.env` file:

```dotenv
MAGNIBOX_MTA_HOSTNAME=mail.example.net
MAGNIBOX_DMS_IMAGE=ghcr.io/docker-mailserver/docker-mailserver:<PINNED_RELEASE>
MAGNIBOX_TLS_DIR=/srv/magnibox/tls
```

Replace every example value. Use an audited, pinned release tag or immutable image digest; do not use `:latest`. Put `fullchain.pem` and `privkey.pem` in the TLS directory and restrict access to the private key. Keep both `.env` and `mailserver.env` out of Git.

Validate the rendered Compose configuration before starting anything:

```sh
docker compose config --quiet
```

Only after the host, image, certificate, storage, firewall and backup checks are complete:

```sh
docker compose pull
docker compose up -d
docker compose ps
docker logs --tail=200 magnibox-mailserver
```

## Initial pilot account and DKIM

For an isolated pilot domain only, create a test mailbox using the image's setup command:

```sh
docker exec -it magnibox-mailserver setup email add pilot@example.net
docker exec -it magnibox-mailserver setup config dkim domain example.net
```

Protect the generated DKIM private key on the host. Publish only the corresponding public TXT record at the selector and domain specified by the generated configuration. Never copy private DKIM material into MAGNISA, Git, browser storage or support tickets.

This account is a technical pilot account. It is not the final dynamic identity-provisioning mechanism for each MAGNISA organization.

## Connect the application only after validation

The application-side SMTP adapter expects server-only settings:

- `MAGNIBOX_SMTP_HOST`: the MTA FQDN.
- `MAGNIBOX_SMTP_PORT=587`.
- `MAGNIBOX_SMTP_SECURE=false` (STARTTLS is required by the current adapter).
- `MAGNIBOX_SMTP_USER` and `MAGNIBOX_SMTP_PASSWORD`: a dedicated submission account.
- `MAGNIBOX_SMTP_HELO`: the MTA FQDN.

Do not put credentials in `NEXT_PUBLIC_*` variables. Do not set `MAGNIBOX_EXTERNAL_MAIL_ENABLED=true` as part of this scaffold. The current application sender authorization and domain/address approval checks must remain in force.

Before connecting the application, verify authenticated submission with TLS and confirm the Postfix queue ID format matches the parser in `src/lib/orbit/transport/smtp.ts`. Then perform controlled tests to independent mailboxes and inspect final delivery outcomes; SMTP queue acceptance alone is not delivery confirmation.

## DNS and public activation gate

For each domain, MAGNIBOX must provide exact DNS instructions and verify the records before activation:

- MX points to the chosen mail host.
- SPF authorizes only the intended outbound hosts.
- DKIM public key matches the private signing key.
- DMARC starts with a monitored policy and is strengthened after reports are reviewed.
- The mail host A/AAAA and PTR/rDNS are consistent with its SMTP identity.
- TLS validates for the advertised host.

Do not change a customer's MX automatically. A root-domain MX change can redirect all incoming mail away from the customer's existing provider. Prefer a pilot subdomain until the customer explicitly approves a migration.

## Remaining implementation work

1. Implement and test the Postfix delivery bridge that sends filtered inbound messages to `/api/internal/magnibox/inbound` using the documented timestamped HMAC signature.
2. Implement signed delivery/deferred/bounce event forwarding to `/api/internal/magnibox/delivery-event`.
3. Define a secure dynamic sender/recipient provisioning contract for multiple MAGNISA organizations; the pilot account above is not sufficient.
4. Add queue monitoring, retry/dead-letter procedures, backup/restore tests, abuse handling and reputation monitoring.
5. Run external send-and-receive tests with independent providers before any public activation.

## Upstream technical references

- [Docker Mailserver usage and configuration](https://docker-mailserver.github.io/docker-mailserver/latest/usage/)
- [Docker Mailserver environment variables](https://docker-mailserver.github.io/docker-mailserver/latest/config/environment/)
- [Docker Mailserver TLS configuration](https://docker-mailserver.github.io/docker-mailserver/latest/config/security/ssl/)
- [DKIM, DMARC and SPF setup](https://docker-mailserver.github.io/docker-mailserver/latest/config/best-practices/dkim_dmarc_spf/)
- [Rspamd integration](https://docker-mailserver.github.io/docker-mailserver/edge/config/security/rspamd/)

This is an infrastructure preparation commit only. It does not deploy a server, create DNS records, change Vercel secrets, alter production data or enable external mail.

## Postfix-to-MAGNIBOX inbound bridge (staged, not enabled)

The `bridge/postfix-inbound.py` pipe program implements the application contract already present at `/api/internal/magnibox/inbound`:

- It receives the envelope recipient from Postfix, not from an untrusted message header.
- It extracts a bounded text body, creates a deterministic fallback message ID, and signs the exact JSON bytes with the timestamped HMAC-SHA256 contract.
- It requires an HTTPS endpoint, a 32-character minimum secret, a short network timeout and rejects redirects.
- Temporary upstream/network failures return Postfix's temporary-failure exit code so the queue can retry. Invalid messages and permanent API rejections return a permanent-failure code.
- Attachments are deliberately rejected rather than silently discarded; the current MAGNIBOX inbound API stores text only.

The bridge is mounted read-only at `/opt/magnibox-bridge`. Contract tests can be run with:

```sh
bash scripts/ci/check-magnibox-inbound-bridge.sh
```

The example Postfix transport files are intentionally **not active**. They must not be copied into the live Postfix configuration until MAGNIBOX has a tested dynamic accepted-domain/recipient provisioning source. Enabling `virtual_transport` prematurely can reject valid mail or route domains incorrectly. A dedicated pilot domain and an end-to-end test are required before enabling this transport. The current Docker Mailserver mailbox path remains unchanged.

No production endpoint, DNS record, MX, MTA host, or runtime secret is changed by this bridge code.
## Signed Postfix delivery-event forwarder (opt-in profile)

The optional `delivery-events` Compose profile tails the Docker Mailserver SMTP log and forwards queue outcomes to the application's signed `/api/internal/magnibox/delivery-event` endpoint:

- `status=sent` becomes `delivered`: the next-hop remote SMTP server accepted the message. This does **not** prove inbox placement, human reading or opening.
- `status=bounced` becomes `bounced`.
- `status=deferred` becomes `deferred` (the application conservatively displays this as uncertain until a later terminal event).
- `status=expired` becomes `failed`.

The forwarder signs the exact JSON bytes with a dedicated timestamped HMAC-SHA256 secret, separate from the inbound bridge secret. Compromise of the event-forwarder credential therefore does not authorize inbound message injection. It persists its file inode and byte offset using an atomic cursor write, retries endpoint failures without advancing the cursor, and starts a new log file at offset zero after rotation. Replayed events are safe because the delivery endpoint updates by Postfix queue ID and state.

### Enable only after application secrets and endpoint are configured

Set these host-only values in the uncommitted Compose `.env` file:

```dotenv
MAGNIBOX_FORWARDER_IMAGE=python:3.12-alpine@sha256:<VERIFIED_IMAGE_DIGEST>
MAGNIBOX_DELIVERY_EVENT_URL=https://<MAGNISA_HOST>/api/internal/magnibox/delivery-event
MAGNIBOX_DELIVERY_EVENT_WEBHOOK_SECRET=<dedicated-strong-secret-configured-in-MAGNISA>
```

Use a verified immutable image digest; the placeholder above is not deployable. Configure the matching `MAGNIBOX_DELIVERY_EVENT_WEBHOOK_SECRET` in the MAGNISA server environment. Keep it distinct from `MAGNIBOX_INBOUND_WEBHOOK_SECRET`. Set `MAGNIBOX_EXTERNAL_MAIL_ENABLED=true` only after all public activation gates have been approved. The delivery-events service is not started by the default Compose profile.

Prepare a writable persistent cursor directory for UID/GID 10001, then explicitly opt into the profile:

```sh
mkdir -p docker-data/event-forwarder
sudo chown 10001:10001 docker-data/event-forwarder
docker compose --profile delivery-events config --quiet
docker compose --profile delivery-events up -d delivery-events
docker compose logs --tail=100 magnibox-delivery-events
```

The sidecar has no Linux capabilities, a read-only root filesystem, read-only mail-log/code mounts and only one writable cursor directory. It does not mount the Docker socket. Verify log file readability for UID 10001 before enabling it.

Log rotation is handled by detecting a changed inode or a truncated file. During rename-and-create rotation, operators should allow the forwarder to drain the old log before removing it; the forwarder follows the active path and durable cursor, not an archive directory. Monitor its logs and disk usage.

The word `delivered` in MAGNIBOX means accepted by the remote next-hop SMTP server, not confirmed inbox placement. Delivery receipts do not provide read/open tracking.
