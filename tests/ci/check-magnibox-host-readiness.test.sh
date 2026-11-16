#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/infra/magnibox-mail/scripts/check-host-readiness.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin"

cat > "$TMP/bin/dig" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
case "$*" in
  "+short A mail.test") printf '%s\n' "8.8.8.8" ;;
  "+short -x 8.8.8.8") printf '%s\n' "${MOCK_PTR:-mail.test}." ;;
  "+short MX gmail.com") printf '%s\n' "10 ${MOCK_MX:-mx.gmail.test}." ;;
  *) exit 1 ;;
esac
MOCK
cat > "$TMP/bin/nc" <<'MOCK'
#!/usr/bin/env bash
exit "${MOCK_NC_EXIT:-0}"
MOCK
chmod +x "$TMP/bin/dig" "$TMP/bin/nc"
export PATH="$TMP/bin:$PATH"

run_ok() {
  if ! output="$(MAGNIBOX_MTA_HOSTNAME=mail.test bash "$SCRIPT" 2>&1)"; then
    printf 'Expected success, got failure:\n%s\n' "$output" >&2
    exit 1
  fi
  printf '%s\n' "$output" | grep -q "A and PTR records agree"
  printf '%s\n' "$output" | grep -q "Outbound TCP/25 reached"
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
    printf 'Expected error "%s", got:\n%s\n' "$expected" "$output" >&2
    exit 1
  }
}

run_ok
run_fail "Reverse DNS" MOCK_PTR=wrong.test
run_fail "Outbound TCP/25 cannot reach" MOCK_NC_EXIT=1
run_fail "MAGNIBOX_MTA_HOSTNAME is required" env -u MAGNIBOX_MTA_HOSTNAME
printf '%s\n' "MAGNIBOX host readiness preflight tests passed (success, PTR mismatch, blocked outbound TCP/25, missing hostname)."
