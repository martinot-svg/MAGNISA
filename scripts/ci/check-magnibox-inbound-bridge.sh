#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
python3 -m py_compile "$ROOT/infra/magnibox-mail/bridge/postfix-inbound.py"
python3 -m unittest discover -s "$ROOT/infra/magnibox-mail/bridge" -p 'test_*.py' -v
grep -Fq 'virtual_transport = magnibox-inbound' "$ROOT/infra/magnibox-mail/postfix-main.cf.example"
grep -Fq 'NoRedirect' "$ROOT/infra/magnibox-mail/bridge/postfix-inbound.py"
grep -Fq 'https' "$ROOT/infra/magnibox-mail/bridge/postfix-inbound.py"
printf 'Magnibox Postfix inbound bridge checks passed.\\n'
