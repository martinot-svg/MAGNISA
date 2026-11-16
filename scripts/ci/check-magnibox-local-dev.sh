#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE="$ROOT/infra/magnibox-mail/compose.local.yaml"
ENV_EXAMPLE="$ROOT/infra/magnibox-mail/.env.local-dev.example"
DOC="$ROOT/infra/magnibox-mail/LOCAL-DEV.md"
WORKER="$ROOT/scripts/magnibox/scan-attachments.ts"
INTEGRATION="$ROOT/scripts/magnibox/attachment-worker-integration.mjs"

test -s "$COMPOSE"
test -s "$ENV_EXAMPLE"
test -s "$DOC"
test -s "$WORKER"
test -s "$INTEGRATION"
node --check "$INTEGRATION"
grep -Fq '"test:magnibox:integration"' "$ROOT/package.json"
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

# Keep the sample environment contract synchronized with the worker implementation.
grep -Fq 'MAGNIBOX_CLAMAV_HOST: clamav' "$COMPOSE"
grep -Fq 'host.docker.internal:host-gateway' "$COMPOSE"
grep -Fq 'NEXT_PUBLIC_SUPABASE_URL=http://host.docker.internal:54321' "$ENV_EXAMPLE"
grep -Fq 'SUPABASE_SERVICE_ROLE_KEY=replace-with-local-supabase-service-role-key' "$ENV_EXAMPLE"
grep -Fq 'process.env.NEXT_PUBLIC_SUPABASE_URL' "$WORKER"
grep -Fq 'process.env.SUPABASE_SERVICE_ROLE_KEY' "$WORKER"
if grep -Eq 'NEXT_PUBLIC_.*SERVICE_ROLE_KEY|MAGNIBOX_WORKER_(SUPABASE_URL|SERVICE_ROLE_KEY)' "$ENV_EXAMPLE"; then
  echo "Local MAGNIBOX environment sample exposes an unsupported or unsafe variable name." >&2
  exit 1
fi

grep -Fq 'supabase db reset' "$DOC"
grep -Fq 'ne jamais la committer' "$DOC"
grep -Fq 'SUPABASE_SERVICE_ROLE_KEY' "$DOC"
echo "MAGNIBOX local development safety checks passed."
