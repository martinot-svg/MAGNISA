#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE="$ROOT/infra/magnibox-mail/compose.local.yaml"
ENV_EXAMPLE="$ROOT/infra/magnibox-mail/.env.local-dev.example"
DOC="$ROOT/infra/magnibox-mail/LOCAL-DEV.md"

test -s "$COMPOSE"
test -s "$ENV_EXAMPLE"
test -s "$DOC"
test -s "$ROOT/supabase/config.toml"
test -s "$ROOT/scripts/magnibox/attachment-scan-core.test.ts"

# The local validation stack must not expose any host ports or start the MTA.
if grep -Eq '^[[:space:]]*ports:' "$COMPOSE"; then
  echo "Local MAGNIBOX compose must not publish ports." >&2
  exit 1
fi
if grep -Eq '^[[:space:]]*mailserver:' "$COMPOSE"; then
  echo "Local MAGNIBOX compose must not start the public MTA." >&2
  exit 1
fi
grep -Fq 'MAGNIBOX_CLAMAV_HOST: clamav' "$COMPOSE"
grep -Fq 'host.docker.internal:host-gateway' "$COMPOSE"
grep -Fq 'MAGNIBOX_WORKER_SERVICE_ROLE_KEY' "$ENV_EXAMPLE"
grep -Fq 'MAGNIBOX_WORKER_SERVICE_ROLE_KEY=replace-with-local-supabase-service-role-key' "$ENV_EXAMPLE"
grep -Fq 'supabase db reset' "$DOC"
grep -Fq 'ne pas la committer' "$DOC"
echo "MAGNIBOX local development safety checks passed."
