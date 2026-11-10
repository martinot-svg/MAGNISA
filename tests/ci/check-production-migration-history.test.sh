#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GUARD="$ROOT/scripts/ci/check-production-migration-history.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
run_guard() {
  MIGRATIONS_DIR="$1" \
  ALLOWLIST="$2" \
  RECONCILIATION_FILE="$3" \
  REMOTE_LEDGER_FILE="$4" \
    bash "$GUARD"
}

# Exact match, one historical baseline file, and one explicitly allowlisted pending migration.
mkdir -p "$TMP/exact"
: > "$TMP/exact/0000_recovered_core_history.sql"
: > "$TMP/exact/20261101000000_exact.sql"
: > "$TMP/exact/20261102000000_pending.sql"
printf '20261102000000\n' > "$TMP/allow"
printf '# remote_version|remote_name|local_file|mapping_type|evidence_ref|local_sha256\n' > "$TMP/map"
printf '20261101000000|exact\n' > "$TMP/remote"
run_guard "$TMP/exact" "$TMP/allow" "$TMP/map" "$TMP/remote" > "$TMP/exact.log" || fail "exact-match fixture should pass"
grep -q 'Migration ledger preflight passed' "$TMP/exact.log" || fail "success message missing"

# A remote-only version must fail closed without a provenance mapping.
printf '20261001000000|historic_remote\n20261101000000|exact\n' > "$TMP/remote-missing"
if run_guard "$TMP/exact" "$TMP/allow" "$TMP/map" "$TMP/remote-missing" > "$TMP/missing.log" 2>&1; then
  fail "remote-only history without mapping unexpectedly passed"
fi
grep -q 'without a verified local representation' "$TMP/missing.log" || fail "remote-only failure reason missing"

# A same-version rename passes only with an exact local checksum and evidence reference.
mkdir -p "$TMP/renamed"
printf 'CREATE TABLE migration_fixture(id integer);\n' > "$TMP/renamed/20261101000000_local_name.sql"
sha="$(sha256sum "$TMP/renamed/20261101000000_local_name.sql" | awk '{print $1}')"
printf '# remote_version|remote_name|local_file|mapping_type|evidence_ref|local_sha256\n20261101000000|remote_name|20261101000000_local_name.sql|renamed|https://github.com/example/repo/commit/abc123|%s\n' "$sha" > "$TMP/renamed-map"
printf '20261101000000|remote_name\n' > "$TMP/renamed-remote"
: > "$TMP/empty-allow"
run_guard "$TMP/renamed" "$TMP/empty-allow" "$TMP/renamed-map" "$TMP/renamed-remote" > "$TMP/renamed.log" 2>&1 || { cat "$TMP/renamed.log"; fail "checksum-verified rename fixture should pass"; }

# A checksum mismatch must fail closed.
sed 's/[0-9a-f]\{64\}$/0000000000000000000000000000000000000000000000000000000000000000/' "$TMP/renamed-map" > "$TMP/bad-map"
if run_guard "$TMP/renamed" "$TMP/empty-allow" "$TMP/bad-map" "$TMP/renamed-remote" > "$TMP/checksum.log" 2>&1; then
  fail "bad checksum unexpectedly passed"
fi
grep -q 'checksum mismatch' "$TMP/checksum.log" || fail "checksum failure reason missing"



# An empty reconciliation manifest must not silently discard the first local migration.
mkdir -p "$TMP/empty-map"
: > "$TMP/empty-map/20261103000000_unapproved.sql"
printf '# remote_version|remote_name|local_file|mapping_type|evidence_ref|local_sha256\n' > "$TMP/empty-map-manifest"
printf '20261101000000|exact\n' > "$TMP/empty-map-remote"
if run_guard "$TMP/empty-map" "$TMP/empty-allow" "$TMP/empty-map-manifest" "$TMP/empty-map-remote" > "$TMP/empty-map.log" 2>&1; then
  fail "empty reconciliation manifest unexpectedly hid a pending migration"
fi
grep -q 'Unreviewed pending local versions: 1' "$TMP/empty-map.log" || fail "empty manifest pending migration was not detected"

# A renamed local SQL file that represents an already-applied remote migration
# must not be treated as pending and re-executed by db push.
mkdir -p "$TMP/mapped-source"
printf 'CREATE TABLE migration_fixture(id integer);\n' > "$TMP/mapped-source/20261102000000_local_name.sql"
mapped_sha="$(sha256sum "$TMP/mapped-source/20261102000000_local_name.sql" | awk '{print $1}')"
printf '# remote_version|remote_name|local_file|mapping_type|evidence_ref|local_sha256\n20261101000000|remote_name|20261102000000_local_name.sql|renamed|https://github.com/example/repo/commit/def456|%s\n' "$mapped_sha" > "$TMP/mapped-source-map"
printf '20261101000000|remote_name\n' > "$TMP/mapped-source-remote"
run_guard "$TMP/mapped-source" "$TMP/empty-allow" "$TMP/mapped-source-map" "$TMP/mapped-source-remote" > "$TMP/mapped-source.log" 2>&1 || { cat "$TMP/mapped-source.log"; fail "mapped local-only migration must not be re-executed"; }
grep -q 'Local versions not recorded remotely: 0' "$TMP/mapped-source.log" || fail "mapped source still counted as pending"

echo "Migration history guard fixtures passed."
