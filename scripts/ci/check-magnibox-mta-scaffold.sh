#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE="$ROOT/infra/magnibox-mail/compose.yaml"
ENV_EXAMPLE="$ROOT/infra/magnibox-mail/mailserver.env.example"
README="$ROOT/infra/magnibox-mail/README.md"
WORKER_DOCKERFILE="$ROOT/infra/magnibox-mail/worker/Dockerfile"
GITIGNORE="$ROOT/.gitignore"

fail() { printf 'Magnibox MTA scaffold check failed: %s\n' "$1" >&2; exit 1; }
has() { grep -Fq -- "$2" "$1" || fail "missing expected configuration: $2"; }

[[ -f "$COMPOSE" && -f "$ENV_EXAMPLE" && -f "$README" && -f "$WORKER_DOCKERFILE" ]] || fail "scaffold files missing"

has "$COMPOSE" '${MAGNIBOX_DMS_IMAGE:?'
has "$COMPOSE" '${MAGNIBOX_MTA_HOSTNAME:?'
has "$COMPOSE" '${MAGNIBOX_TLS_DIR:?'
has "$COMPOSE" '${MAGNIBOX_BIND_ADDRESS:-127.0.0.1}:25:25'
has "$COMPOSE" '${MAGNIBOX_BIND_ADDRESS:-127.0.0.1}:587:587'
has "$COMPOSE" '${MAGNIBOX_BIND_ADDRESS:-127.0.0.1}:993:993'
has "$README" 'Safe network binding — loopback by default'
has "$README" 'MAGNIBOX_BIND_ADDRESS=127.0.0.1'
has "$COMPOSE" 'restart: unless-stopped'
has "$COMPOSE" 'NET_ADMIN'
has "$COMPOSE" 'attachment-worker:'
has "$COMPOSE" 'network_mode: "service:mailserver"'
has "$COMPOSE" 'MAGNIBOX_WORKER_SERVICE_ROLE_KEY'
has "$COMPOSE" 'MAGNIBOX_FORWARDER_IMAGE'
has "$COMPOSE" './mailserver.env'
has "$COMPOSE" 'MAGNIBOX_FORWARDER_IMAGE:-python:3.12-alpine'

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
has "$ENV_EXAMPLE" 'CLAMAV_MESSAGE_SIZE_LIMIT=26214400'
has "$ENV_EXAMPLE" 'POSTFIX_MESSAGE_SIZE_LIMIT=26214400'
has "$ENV_EXAMPLE" 'MAGNIBOX_DELIVERY_EVENT_URL='
has "$ENV_EXAMPLE" 'MAGNIBOX_DELIVERY_EVENT_WEBHOOK_SECRET='
has "$ENV_EXAMPLE" 'TLS_LEVEL=modern'
has "$ENV_EXAMPLE" 'SSL_TYPE=manual'
has "$ENV_EXAMPLE" 'SSL_CERT_PATH=/run/magnibox-tls/fullchain.pem'
has "$ENV_EXAMPLE" 'SSL_KEY_PATH=/run/magnibox-tls/privkey.pem'

has "$GITIGNORE" 'infra/magnibox-mail/mailserver.env'
has "$GITIGNORE" 'infra/magnibox-mail/docker-data/'
has "$GITIGNORE" 'infra/magnibox-mail/*.pem'
has "$GITIGNORE" 'infra/magnibox-mail/*.key'

has "$README" 'The MAGNISA application inbox is Supabase-backed'
has "$README" 'Do not use a server behind carrier-grade NAT'
has "$README" 'Do not set `MAGNIBOX_EXTERNAL_MAIL_ENABLED=true`'
has "$README" 'Postfix-to-MAGNIBOX'
has "$README" 'MAGNIBOX_WORKER_SUPABASE_URL'
has "$WORKER_DOCKERFILE" 'tsx@4.20.6'
has "$WORKER_DOCKERFILE" 'USER node'
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  MAIL_ENV="$ROOT/infra/magnibox-mail/mailserver.env"
  created_mail_env=0
  if [[ ! -f "$MAIL_ENV" ]]; then
    : > "$MAIL_ENV"
    created_mail_env=1
  fi
  cleanup() { if [[ "$created_mail_env" == "1" ]]; then rm -f "$MAIL_ENV"; fi; }
  trap cleanup EXIT
  env MAGNIBOX_DMS_IMAGE=ghcr.io/docker-mailserver/docker-mailserver:v16.0 MAGNIBOX_MTA_HOSTNAME=mail.example.invalid MAGNIBOX_TLS_DIR=/tmp/magnibox-tls MAGNIBOX_WORKER_SUPABASE_URL=https://example.supabase.co MAGNIBOX_WORKER_SERVICE_ROLE_KEY=ci-placeholder-service-role-key MAGNIBOX_FORWARDER_IMAGE=python:3.12-alpine MAGNIBOX_DELIVERY_EVENT_URL=https://example.invalid/api/internal/magnibox/delivery-event MAGNIBOX_DELIVERY_EVENT_WEBHOOK_SECRET=ci-placeholder-delivery-secret docker compose -f "$COMPOSE" config --quiet
fi
printf 'Magnibox MTA scaffold checks passed.\n'
