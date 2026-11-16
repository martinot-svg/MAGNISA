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

The MAGNISA application inbox is Supabase-backed; it does not mirror the separate Dovecot pilot mailboxes. The signed Postfix-to-MAGNIBOX inbound bridge, recipient snapshot API and versioned Postfix map synchronizer are now implemented, but remain staged and unactivated. An operator must configure the host-only secrets, run and inspect the map synchronization, enable the example Postfix transport under an approved pilot procedure, and complete end-to-end validation before public use. DNS records are never changed automatically.

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
MAGNIBOX_WORKER_SUPABASE_URL=https://your-project.supabase.co
MAGNIBOX_WORKER_SERVICE_ROLE_KEY=server-only-service-role-key
```

Replace every example value. Use an audited, pinned release tag or immutable image digest; do not use `:latest`. Put `fullchain.pem` and `privkey.pem` in the TLS directory and restrict access to the private key. Keep both `.env` and `mailserver.env` out of Git. The worker reads the Supabase URL and service-role key only from this uncommitted host `.env`; never place the service-role key in `mailserver.env`, a `NEXT_PUBLIC_*` variable or source control.

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
docker compose logs --tail=100 attachment-worker
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

## Worker de scan des pièces jointes

Le service `attachment-worker` est construit depuis le dépôt et partage l'espace réseau du conteneur MTA afin d'atteindre ClamAV sur `127.0.0.1:3310`. Il exécute le worker TypeScript toutes les 60 secondes, sans port entrant, avec système de fichiers en lecture seule, capacités Linux supprimées et clé Supabase réservée au serveur. Les migrations et le bucket privé doivent être appliqués avant de démarrer ce service.

Sur l'hôte pilote, configure `MAGNIBOX_WORKER_SUPABASE_URL` et `MAGNIBOX_WORKER_SERVICE_ROLE_KEY` dans le fichier `.env` non versionné. Vérifie les journaux avec :

```sh
docker compose logs -f attachment-worker
```

## Derniers contrôles avant activation publique

1. Réussir MAGNISA CI et le replay de toutes les migrations sur le SHA destiné à la production.
2. Sur un domaine pilote isolé, vérifier la réception Postfix réelle, la synchronisation des domaines/destinataires approuvés et les événements de livraison.
3. Démontrer le parcours pièce jointe propre → quarantaine → ClamAV → disponible → téléchargement authentifié, puis vérifier qu'un fichier de test antivirus reste rejeté.
4. Tester les envois et réceptions avec plusieurs fournisseurs indépendants, y compris SPF, DKIM, DMARC, TLS, PTR/rDNS et les retours de livraison.
5. Finaliser la supervision de file, les alertes, les procédures de reprise/dead-letter, les sauvegardes chiffrées et la gestion des abus.

Ces contrôles nécessitent un hôte MTA, des secrets d'exploitation et des validations DNS appartenant à l'opérateur. Le code ne les simule pas et ne modifie aucun MX client automatiquement.

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
- Attachments are extracted as bounded base64 payloads and written only to the private quarantine bucket. They remain unavailable until the isolated scan worker validates their actual file signature and ClamAV verdict.

The bridge is mounted read-only at `/opt/magnibox-bridge`. Contract tests can be run with:

```sh
bash scripts/ci/check-magnibox-inbound-bridge.sh
```

The example Postfix transport files are intentionally **not active**. The signed provisioning API and host-side map synchronizer are implemented: they publish only approved recipients on verified domains, validate the snapshot HMAC and revision, and switch a versioned map generation atomically. They still require a controlled host-side run and operator review; they do not reload Postfix or change DNS. Enabling `virtual_transport` prematurely can reject valid mail or route domains incorrectly. A dedicated pilot domain and an end-to-end receive test are required before enabling this transport. The current Docker Mailserver mailbox path remains unchanged.

No production endpoint, DNS record, MX, MTA host, or runtime secret is changed by this bridge code.

## ClamAV readiness gate for MAGNIBOX attachments

The mailserver profile enables ClamAV with \`ENABLE_CLAMAV=1\`. Before any attachment-ingestion work is enabled, run this read-only preflight on the MTA host:

\`\`\`sh
sh infra/magnibox-mail/scripts/check-antivirus-readiness.sh
\`\`\`

The script verifies that the mailserver container is running, ClamAV is enabled in its environment, and \`clamdscan\` can complete a harmless scan against \`/etc/hostname\`. It does not change configuration or enable attachment delivery.

**Important:** a successful daemon check is not proof that every Postfix delivery traverses the antivirus filter, nor does it prove that a message with an infected attachment is rejected before the MAGNIBOX pipe transport. Before enabling attachments, an isolated integration test must demonstrate both clean-message delivery and infected-message rejection through the exact configured Postfix path. The bridge now forwards attachments to quarantine, but the transport must remain disabled for public customer domains until the clean/infected end-to-end test, migration replay and CI gates pass.


### Bounded attachment ingestion (staged)

The inbound bridge accepts up to five attachments per message, with a maximum of 30 MiB per file and 150 MiB aggregate attachment payload. The application inbound request/message ceiling is 205 MiB; the Postfix container transport limit is configured separately at 220M to provide transport headroom. The bridge, application validation and scan worker enforce the attachment limits; the worker processes files up to 30 MiB. The application verifies the signed payload and base64 limits, stores objects under organization/message/UUID paths in the private `magnibox-attachments` bucket, and creates quarantined metadata with SHA-256. The worker alone can promote files to `available`. The download endpoint first checks the authenticated user's RLS-visible metadata row and only then creates a 60-second signed URL with the server service role. No browser Storage policy is added.


## Read-only host/network readiness preflight

Before configuring Postfix or connecting the application, run the following on the intended dedicated Linux host:

```sh
MAGNIBOX_MTA_HOSTNAME=mail.example.net sh infra/magnibox-mail/scripts/check-host-readiness.sh
```

Optionally set `MAGNIBOX_SMTP_PROBE_DOMAIN` to another independent domain whose MX host accepts SMTP on TCP/25. The preflight checks that the MTA hostname has globally routable IPv4 A records, that each address has a matching PTR record, and that outbound TCP/25 can reach a remote MX. It is read-only: it does not alter DNS/firewall settings, start containers, or enable external mail.

A successful local preflight does **not** prove inbound TCP/25 reachability from the public Internet. Verify that separately from an external network and obtain written provider confirmation for TCP/25 in both directions. CI only checks the script's shell syntax; it cannot verify a real host, public IP, DNS delegation or provider policy.
