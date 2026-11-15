#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
python3 -m py_compile "$ROOT/infra/magnibox-mail/bridge/postfix-delivery-events.py"
python3 -m unittest discover -s "$ROOT/infra/magnibox-mail/bridge" -p 'test_*.py' -v
grep -Fq 'MAGNIBOX_DELIVERY_EVENT_URL' "$ROOT/infra/magnibox-mail/bridge/postfix-delivery-events.py"
grep -Fq 'MAGNIBOX_DELIVERY_EVENT_WEBHOOK_SECRET' "$ROOT/infra/magnibox-mail/bridge/postfix-delivery-events.py"
grep -Fq 'MAGNIBOX_DELIVERY_EVENT_WEBHOOK_SECRET' "$ROOT/src/app/api/internal/magnibox/delivery-event/route.ts"
grep -Fq 'MAGNIBOX_DELIVERY_EVENT_WEBHOOK_SECRET' "$ROOT/infra/magnibox-mail/compose.yaml"
grep -Fq 'x-magnibox-signature' "$ROOT/infra/magnibox-mail/bridge/postfix-delivery-events.py"
printf 'Magnibox Postfix delivery-event checks passed.\n'
