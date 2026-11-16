#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="$ROOT/infra/magnibox-mail/compose.mailpit.yaml"

command -v docker >/dev/null 2>&1 || {
  echo "ERROR: Docker is required to validate the Mailpit Compose file." >&2
  exit 1
}
docker compose version >/dev/null

grep -Fq 'image: axllent/mailpit:v1.33.1' "$COMPOSE_FILE"
grep -Fq '"127.0.0.1:1025:1025"' "$COMPOSE_FILE"
grep -Fq '"127.0.0.1:8025:8025"' "$COMPOSE_FILE"
! grep -Eq '(^|[[:space:]])(0\.0\.0\.0|\*:)(1025|8025):' "$COMPOSE_FILE"

docker compose -f "$COMPOSE_FILE" config --quiet
echo "MAGNIBOX Mailpit Compose configuration is valid and loopback-only."
