#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE="$ROOT/infra/magnibox-mail/compose.yaml"
ENV_EXAMPLE="$ROOT/infra/magnibox-mail/mailserver.env.example"
README="$ROOT/infra/magnibox-mail/README.md"
GITIGNORE="$ROOT/.gitignore"

fail() { printf 'Magnibox MTA scaffold check failed: %s\n' "$1" >&2; exit 1; }
has() { grep -Fq -- "$2" "$1" || fail "missing expected configuration: $2"; }

[[ -f "$COMPOSE" && -f "$ENV_EXAMPLE" && -f "$README" ]] || fail "scaffold files missing"

has "$COMPOSE" '${MAGNIBOX_DMS_IMAGE:?'
has "$COMPOSE" '${MAGNIBOX_MTA_HOSTNAME:?'
has "$COMPOSE" '${MAGNIBOX_TLS_DIR:?'
has "$COMPOSE" '"25:25"'
has "$COMPOSE" '"587:587"'
has "$COMPOSE" '"993:993"'
has "$COMPOSE" 'restart: unless-stopped'
has "$COMPOSE" 'NET_ADMIN'
has "$COMPOSE" './docker-data/provisioning:/etc/postfix/magnibox:ro'

if grep -Eiq '(^|[/:])latest([[:space:]"\047]|$)' "$COMPOSE"; then
  fail "floating latest image tags are forbidden"
fi
if grep -Eq 'docker\.sock|privileged:[[:space:]]*true' "$COMPOSE"; then
  fail "dangerous Docker host access is forbidden"
fi

has "$ENV_EXAMPLE" 'ENABLE_RSPAMD=1'
has "$ENV_EXAMPLE" 'ENABLE_CLAMAV=1'
has "$ENV_EXAMPLE" 'ENABLE_FAIL2BAN=1'
has "$ENV_EXAMPLE" 'PERMIT_DOCKER=none'
has "$ENV_EXAMPLE" 'TLS_LEVEL=modern'
has "$ENV_EXAMPLE" 'SSL_TYPE=manual'
has "$ENV_EXAMPLE" 'SSL_CERT_PATH=/run/magnibox-tls/fullchain.pem'
has "$ENV_EXAMPLE" 'SSL_KEY_PATH=/run/magnibox-tls/privkey.pem'
has "$ENV_EXAMPLE" 'MAGNIBOX_INBOUND_URL='
has "$ENV_EXAMPLE" 'MAGNIBOX_INBOUND_WEBHOOK_SECRET='
has "$ENV_EXAMPLE" 'MAGNIBOX_PROVISIONING_URL='
has "$ENV_EXAMPLE" 'MAGNIBOX_PROVISIONING_WEBHOOK_SECRET='

has "$GITIGNORE" 'infra/magnibox-mail/mailserver.env'
has "$GITIGNORE" 'infra/magnibox-mail/docker-data/'
has "$GITIGNORE" 'infra/magnibox-mail/*.pem'
has "$GITIGNORE" 'infra/magnibox-mail/*.key'

has "$README" 'does **not** yet connect Dovecot mailboxes'
has "$README" 'Do not use a server behind carrier-grade NAT'
has "$README" 'Do not set `MAGNIBOX_EXTERNAL_MAIL_ENABLED=true`'
has "$README" 'Postfix-to-MAGNIBOX'
has "$README" 'virtual_mailbox_domains'
has "$README" 'virtual_mailbox_maps'
printf 'Magnibox MTA scaffold checks passed.\n'
