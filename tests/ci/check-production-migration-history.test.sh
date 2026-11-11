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
  REPLAY_ONLY_FILE="${5:-$1/production-local-replay-only.txt}" \
    bash "$GUARD"
}

# Exact match, one historical baseline file, and one explicitly allowlisted pending migration.
mkdir -p "$TMP/exact"
: > "$TMP/exact/0000_recovered_core_history.sql"
printf 'CREATE TABLE migration_fixture(id integer);\n' > "$TMP/exact/20261101000000_exact.sql"
: > "$TMP/exact/20261102000000_pending.sql"
exact_sha="$(sha256sum "$TMP/exact/20261101000000_exact.sql" | awk '{print $1}')"
printf '20261102000000\n' > "$TMP/allow"
printf '# remote_version|remote_name|local_file|mapping_type|evidence_ref|local_sha256\n' > "$TMP/map"
printf '20261101000000|exact\n' > "$TMP/remote"
run_guard "$TMP/exact" "$TMP/allow" "$TMP/map" "$TMP/remote" > "$TMP/exact.log" || fail "exact-match fixture should pass"
grep -q 'Migration ledger preflight passed' "$TMP/exact.log" || fail "success message missing"

# Production's statement ledger has a known one-character serialization prefix.
# The guard must request the normalized statement digest, not compare the prefixed bytes.
mkdir -p "$TMP/fake-bin"
cat > "$TMP/fake-bin/psql" <<'PSQL'
#!/usr/bin/env bash
query="$*"
if [[ "$query" == *"cardinality(statements)=1"* && "$query" == *"substr(statements[1],2)"* ]]; then
  printf '20261101000000|exact|%s\n' "${EXPECTED_LOCAL_SHA:?}"
  exit 0
fi
echo "Expected checksum normalization query was not used" >&2
exit 2
PSQL
chmod +x "$TMP/fake-bin/psql"
EXPECTED_LOCAL_SHA="$exact_sha" SUPABASE_DB_URL=mock PATH="$TMP/fake-bin:$PATH" \
  MIGRATIONS_DIR="$TMP/exact" ALLOWLIST="$TMP/allow" \
  RECONCILIATION_FILE="$TMP/map" REPLAY_ONLY_FILE="$TMP/exact/production-local-replay-only.txt" \
  bash "$GUARD" > "$TMP/normalized-ledger.log" 2>&1 || { cat "$TMP/normalized-ledger.log"; fail "normalized production ledger checksum should pass"; }
grep -q 'Migration ledger preflight passed' "$TMP/normalized-ledger.log" || fail "normalized ledger success message missing"

# A direct version/name match must also match the production SQL statement hash.
mkdir -p "$TMP/direct-hash-mismatch"
printf 'CREATE TABLE migration_fixture(id integer);\n' > "$TMP/direct-hash-mismatch/20261101000000_exact.sql"
wrong_sha="$(printf 'different SQL\n' | sha256sum | awk '{print $1}')"
printf '20261101000000|exact|%s\n' "$wrong_sha" > "$TMP/direct-hash-mismatch-remote"
if run_guard "$TMP/direct-hash-mismatch" "$TMP/empty-allow" "$TMP/map" "$TMP/direct-hash-mismatch-remote" > "$TMP/direct-hash-mismatch.log" 2>&1; then
  fail "direct migration with a different production SQL hash unexpectedly passed"
fi
grep -q 'Local SQL checksum differs from production' "$TMP/direct-hash-mismatch.log" || fail "direct SQL hash mismatch reason missing"

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

# An explicit recovered source may preserve the production SQL while a local
# replay-only compatibility wrapper guards an absent historical prerequisite.
mkdir -p "$TMP/compat"
printf 'local replay compatibility\n' > "$TMP/compat/20261101000000_local_name.sql"
printf 'CREATE TABLE migration_fixture(id integer);\n' > "$TMP/compat/archive_original.sql"
compat_sha="$(sha256sum "$TMP/compat/archive_original.sql" | awk '{print $1}')"
printf '# remote_version|remote_name|local_file|mapping_type|evidence_ref|local_sha256\n20261101000000|remote_name|archive_original.sql|recovered|archived production SQL|%s\n' "$compat_sha" > "$TMP/compat-map"
printf '20261101000000|remote_name|%s\n' "$compat_sha" > "$TMP/compat-remote"
run_guard "$TMP/compat" "$TMP/empty-allow" "$TMP/compat-map" "$TMP/compat-remote" > "$TMP/compat.log" 2>&1 || { cat "$TMP/compat.log"; fail "verified replay compatibility mapping should pass"; }

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

# Local replay-only migrations are applied after their prerequisite schema exists,
# but must be excluded from production reconciliation and deployment.
mkdir -p "$TMP/replay-only"
: > "$TMP/replay-only/20261101000000_local_bootstrap.sql"
: > "$TMP/replay-only/20261102000000_remote_head.sql"
printf '# local replay-only versions\n20261101000000\n' > "$TMP/replay-only-versions"
: > "$TMP/empty-allow"
printf '20261102000000|remote_head\n' > "$TMP/replay-only-remote"
run_guard "$TMP/replay-only" "$TMP/empty-allow" "$TMP/empty-map-manifest" "$TMP/replay-only-remote" "$TMP/replay-only-versions" > "$TMP/replay-only.log" || { cat "$TMP/replay-only.log"; fail "local replay-only migration should be excluded from production reconciliation"; }
grep -q 'Local replay-only migration excluded from production ledger' "$TMP/replay-only.log" || fail "replay-only exclusion was not reported"

# A missing local migration older than the current remote head must fail even when allowlisted.
mkdir -p "$TMP/out-of-order"
: > "$TMP/out-of-order/20261101000000_older_pending.sql"
: > "$TMP/out-of-order/20261102000000_remote_head.sql"
printf '20261101000000\n' > "$TMP/out-of-order-allow"
printf '# remote_version|remote_name|local_file|mapping_type|evidence_ref|local_sha256\n' > "$TMP/out-of-order-map"
printf '20261102000000|remote_head\n' > "$TMP/out-of-order-remote"
if run_guard "$TMP/out-of-order" "$TMP/out-of-order-allow" "$TMP/out-of-order-map" "$TMP/out-of-order-remote" > "$TMP/out-of-order.log" 2>&1; then
  fail "out-of-order local migration unexpectedly passed"
fi
grep -q 'older than the latest remote version' "$TMP/out-of-order.log" || fail "out-of-order failure reason missing"

# The production allowlist executor must independently refuse historical versions behind the remote head.
mkdir -p "$TMP/apply-root/scripts/ci" "$TMP/apply-root/supabase/migrations" "$TMP/fake-bin"
cp "$ROOT/scripts/ci/apply-production-allowlist.sh" "$TMP/apply-root/scripts/ci/apply-production-allowlist.sh"
: > "$TMP/apply-root/supabase/migrations/20261101000000_older_pending.sql"
printf '20261101000000\n' > "$TMP/apply-root/supabase/migrations/production-pending-allowlist.txt"
cat > "$TMP/fake-bin/psql" <<'PSQL'
#!/usr/bin/env bash
case "$*" in
  *"max(version)"*) printf '20261102000000\n' ;;
  *"where version = '20261101000000'"*) : ;;
  *) echo "Unexpected psql invocation: $*" >&2; exit 2 ;;
esac
PSQL
chmod +x "$TMP/fake-bin/psql"
if SUPABASE_DB_URL=mock PATH="$TMP/fake-bin:$PATH" bash "$TMP/apply-root/scripts/ci/apply-production-allowlist.sh" dry-run > "$TMP/apply-out-of-order.log" 2>&1; then
  fail "production allowlist executor accepted an out-of-order migration"
fi
grep -q 'Refusing out-of-order migration' "$TMP/apply-out-of-order.log" || fail "production executor out-of-order guard reason missing"

echo "Migration history guard fixtures passed."
