#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-dry-run}"
case "$MODE" in
  dry-run|apply) ;;
  *) echo "Usage: $0 [dry-run|apply]" >&2; exit 2 ;;
esac

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIGRATIONS_DIR="$ROOT/supabase/migrations"
ALLOWLIST="$MIGRATIONS_DIR/production-pending-allowlist.txt"
: "${SUPABASE_DB_URL:?SUPABASE_DB_URL is required}"
command -v psql >/dev/null
command -v supabase >/dev/null
test -f "$ROOT/supabase/config.toml"
test -f "$ALLOWLIST"

mapfile -t ALLOWED_VERSIONS < <(awk 'NF && $1 !~ /^#/ {print $1}' "$ALLOWLIST" | sort)
if [[ ${#ALLOWED_VERSIONS[@]} -eq 0 ]]; then
  echo "No production migrations are allowlisted."
  exit 0
fi
if printf '%s\n' "${ALLOWED_VERSIONS[@]}" | uniq -d | grep -q .; then
  echo "::error::Duplicate versions in production-pending-allowlist.txt"
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
mkdir -p "$TMP_DIR/supabase/migrations"
cp "$ROOT/supabase/config.toml" "$TMP_DIR/supabase/config.toml"

PENDING=0
for version in "${ALLOWED_VERSIONS[@]}"; do
  if [[ ! "$version" =~ ^[0-9]{14}$ ]]; then
    echo "::error::Invalid migration version in allowlist: $version"
    exit 1
  fi

  shopt -s nullglob
  matches=( "$MIGRATIONS_DIR/${version}_"*.sql )
  shopt -u nullglob
  if [[ ${#matches[@]} -ne 1 ]]; then
    echo "::error::Expected exactly one SQL file for allowlisted version $version; found ${#matches[@]}"
    exit 1
  fi

  file="$(basename "${matches[0]}")"
  expected_name="${file#${version}_}"
  expected_name="${expected_name%.sql}"
  remote_name="$(psql "$SUPABASE_DB_URL" -X -qAt -v ON_ERROR_STOP=1 -c "select name from supabase_migrations.schema_migrations where version = '$version'")"

  if [[ -n "$remote_name" ]]; then
    if [[ "$remote_name" != "$expected_name" ]]; then
      echo "::error::Version $version is already recorded with unexpected name '$remote_name' (local '$expected_name')"
      exit 1
    fi
    echo "Already applied: $version $expected_name"
    continue
  fi

  cp "${matches[0]}" "$TMP_DIR/supabase/migrations/$file"
  printf 'Pending approved migration: %s %s sha256=%s\n' \
    "$version" "$expected_name" "$(sha256sum "${matches[0]}" | awk '{print $1}')"
  PENDING=$((PENDING + 1))
done

if [[ "$PENDING" -eq 0 ]]; then
  echo "All allowlisted production migrations are already applied."
  exit 0
fi

echo "Applying only $PENDING approved migration(s); unallowlisted repository migrations are excluded."
if [[ "$MODE" == "dry-run" ]]; then
  (cd "$TMP_DIR" && supabase db push --db-url "$SUPABASE_DB_URL" --include-all --dry-run)
else
  (cd "$TMP_DIR" && supabase db push --db-url "$SUPABASE_DB_URL" --include-all --yes)
fi

if [[ "$MODE" == "apply" ]]; then
  for version in "${ALLOWED_VERSIONS[@]}"; do
    shopt -s nullglob
    matches=( "$MIGRATIONS_DIR/${version}_"*.sql )
    shopt -u nullglob
    file="$(basename "${matches[0]}")"
    expected_name="${file#${version}_}"
    expected_name="${expected_name%.sql}"
    remote_name="$(psql "$SUPABASE_DB_URL" -X -qAt -v ON_ERROR_STOP=1 -c "select name from supabase_migrations.schema_migrations where version = '$version'")"
    if [[ "$remote_name" != "$expected_name" ]]; then
      echo "::error::Migration verification failed for $version: expected '$expected_name', got '${remote_name:-ABSENT}'"
      exit 1
    fi
  done
  echo "Approved production migration set verified."
else
  echo "Dry-run complete; no production migration was applied."
fi
