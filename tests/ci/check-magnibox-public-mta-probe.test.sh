#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/infra/magnibox-mail/scripts/probe-public-endpoints.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin"

cat > "$TMP/bin/nc" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
port="${@: -1}"
[[ "${MOCK_TCP_FAIL_PORT:-}" != "$port" ]]
MOCK
cat > "$TMP/bin/openssl" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
[[ "${MOCK_TLS_FAIL_PORT:-}" == "" || " $* " != *":${MOCK_TLS_FAIL_PORT} "* ]]
MOCK
cat > "$TMP/bin/timeout" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
shift
exec "$@"
MOCK
chmod +x "$TMP/bin/"*
export PATH="$TMP/bin:$PATH"

run_ok() {
  local output
  output="$(MAGNIBOX_MTA_HOSTNAME=mail.test bash "$SCRIPT" 2>&1)" || {
    printf 'Expected success, got:\n%s\n' "$output" >&2
    exit 1
  }
  for expected in "TCP/25 reachable" "TCP/587 reachable" "TCP/993 reachable" "SMTP STARTTLS certificate on mail.test:25" "SMTP STARTTLS certificate on mail.test:587" "IMAPS TLS certificate"; do
    printf '%s\n' "$output" | grep -Fq "$expected" || {
      printf 'Missing success marker: %s\n%s\n' "$expected" "$output" >&2
      exit 1
    }
  done
}

run_fail() {
  local expected="$1"
  shift
  local output
  if output="$(env MAGNIBOX_MTA_HOSTNAME=mail.test "$@" bash "$SCRIPT" 2>&1)"; then
    printf 'Expected failure containing "%s", but command succeeded.\n' "$expected" >&2
    exit 1
  fi
  printf '%s\n' "$output" | grep -Fq "$expected" || {
    printf 'Expected "%s", got:\n%s\n' "$expected" "$output" >&2
    exit 1
  }
}

run_ok
run_fail "Inbound TCP/25 is not reachable" MOCK_TCP_FAIL_PORT=25
run_fail "TLS/STARTTLS verification failed on mail.test:587" MOCK_TLS_FAIL_PORT=587
run_fail "MAGNIBOX_MTA_HOSTNAME is required" env -u MAGNIBOX_MTA_HOSTNAME
printf '%s\n' "MAGNIBOX public MTA probe tests passed (all ports/TLS, blocked port, invalid TLS, missing hostname)."
