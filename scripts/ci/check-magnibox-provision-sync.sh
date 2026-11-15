#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
python3 -m py_compile "$ROOT/infra/magnibox-mail/bridge/postfix-provision-sync.py"
python3 -m unittest discover -s "$ROOT/infra/magnibox-mail/bridge" -p 'test_*.py' -v
printf 'Magnibox Postfix provisioning sync checks passed.\n'
