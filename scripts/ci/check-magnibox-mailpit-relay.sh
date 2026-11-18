#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OVERLAY="$ROOT/infra/magnibox-mail/compose.mailpit-relay.yaml"

test -f "$OVERLAY"
grep -Fq 'DEFAULT_RELAY_HOST: "[mailpit]:1025"' "$OVERLAY"
grep -Fq 'image: axllent/mailpit:v1.33.1' "$OVERLAY"
grep -Fq '"127.0.0.1:1025:1025"' "$OVERLAY"
grep -Fq '"127.0.0.1:8025:8025"' "$OVERLAY"
! grep -Eq '(^|[[:space:]])(0\.0\.0\.0|\*:)(1025|8025):' "$OVERLAY"

echo "MAGNIBOX local Postfix -> Mailpit relay overlay: static safety checks passed."
echo "This check does not start containers or prove SMTP delivery."
