#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/infra/magnibox-mail/scripts/check-antivirus-readiness.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin"

cat > "$TMP/bin/docker" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == "inspect" ]]; then
  printf '%s\n' "${MOCK_CONTAINER_RUNNING:-true}"
  exit 0
fi
if [[ "$1" == "exec" && "$3" == "printenv" ]]; then
  printf '%s\n' "${MOCK_CLAMAV_ENABLED:-1}"
  exit 0
fi
if [[ "$1" == "exec" && "$3" == "sh" ]]; then
  exit "${MOCK_SCAN_EXIT:-0}"
fi
printf 'Unexpected docker invocation: %s\n' "$*" >&2
exit 99
MOCK
chmod +x "$TMP/bin/docker"

run_ok() {
  local output
  if ! output="$(PATH="$TMP/bin:$PATH" /bin/sh "$SCRIPT" 2>&1)"; then
    printf 'Expected success, got failure:\n%s\n' "$output" >&2
    exit 1
  fi
  printf '%s\n' "$output" | grep -Fq "ClamAV est activé"
  printf '%s\n' "$output" | grep -Fq "ne prouve pas"
}

run_fail() {
  local expected="$1"
  shift
  local output
  if output="$(env PATH="$TMP/bin:$PATH" "$@" /bin/sh "$SCRIPT" 2>&1)"; then
    printf 'Expected failure containing "%s", but command succeeded.\n' "$expected" >&2
    exit 1
  fi
  printf '%s\n' "$output" | grep -Fq "$expected" || {
    printf 'Expected error "%s", got:\n%s\n' "$expected" "$output" >&2
    exit 1
  }
}

run_ok
run_fail "n'est pas démarré" MOCK_CONTAINER_RUNNING=false
run_fail "ENABLE_CLAMAV n'est pas égal à 1" MOCK_CLAMAV_ENABLED=0
run_fail "clamdscan est absent ou le démon ClamAV ne répond pas" MOCK_SCAN_EXIT=1
if output="$(PATH="$TMP/no-docker" /bin/sh "$SCRIPT" 2>&1)"; then
  printf 'Expected missing-Docker failure, but command succeeded.\n' >&2
  exit 1
fi
printf '%s\n' "$output" | grep -Fq "docker est introuvable"

printf '%s\n' "MAGNIBOX antivirus readiness tests passed (success, stopped container, disabled ClamAV, failed scan, missing Docker)."
