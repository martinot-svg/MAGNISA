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

  file="${matches[0]}"
  filename="$(basename "$file")"
  expected_name="${filename#${version}_}"
  expected_name="${expected_name%.sql}"
  if [[ ! "$expected_name" =~ ^[a-z0-9_]+$ ]]; then
    echo "::error::Invalid migration name: $expected_name"
    exit 1
  fi

  remote_name="$(psql "$SUPABASE_DB_URL" -X -qAt -v ON_ERROR_STOP=1 \
    -c "select coalesce(name,'') from supabase_migrations.schema_migrations where version = '$version'")"

  if [[ -n "$remote_name" ]]; then
    if [[ "$remote_name" != "$expected_name" ]]; then
      echo "::error::Version $version is already recorded with unexpected name '$remote_name' (local '$expected_name')"
      exit 1
    fi
    echo "Already applied: $version $expected_name"
    continue
  fi

  checksum="$(sha256sum "$file" | awk '{print $1}')"
  printf 'Pending approved migration: %s %s sha256=%s\n' "$version" "$expected_name" "$checksum"
  PENDING=$((PENDING + 1))

  if [[ "$MODE" == "apply" ]]; then
    # Preserve the exact repository migration version in Supabase's ledger.
    # The CLI cannot push a reviewed subset while the historic production
    # ledger contains remote-only versions. Execute one allowlisted file per
    # transaction and record that exact version in the same transaction.
    tag="magnisa_migration_${version}"
    if grep -Fq "$tag" "$file"; then
      echo "::error::Migration contains reserved SQL quote delimiter $tag"
      exit 1
    fi

    wrapper="$TMP_DIR/${filename}.transaction.sql"
    {
      printf 'BEGIN;\n'
      # A legacy migration contains its own outer BEGIN/COMMIT. Remove only
      # standalone transaction-control lines; PL/pgSQL BEGIN blocks remain.
      awk 'tolower($0) !~ /^[[:space:]]*(begin|commit)[[:space:]]*;[[:space:]]*$/' "$file"
      printf '\nINSERT INTO supabase_migrations.schema_migrations(version,name,statements,created_by)\n'
      printf "VALUES ('%s','%s',ARRAY[%s", "$version" "$expected_name" "$tag"
      cat "$file"
      printf '%s]::text[],current_user)\nON CONFLICT (version) DO NOTHING;\nCOMMIT;\n' "$tag"
    } > "$wrapper"

    psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -f "$wrapper"
    verified_name="$(psql "$SUPABASE_DB_URL" -X -qAt -v ON_ERROR_STOP=1 \
      -c "select coalesce(name,'') from supabase_migrations.schema_migrations where version = '$version'")"
    if [[ "$verified_name" != "$expected_name" ]]; then
      echo "::error::Migration ledger verification failed for $version: expected '$expected_name', got '${verified_name:-ABSENT}'"
      exit 1
    fi
    echo "Applied and ledger-verified: $version $expected_name"
  fi
done

if [[ "$MODE" == "dry-run" ]]; then
  echo "Read-only preflight complete: $PENDING approved migration(s) pending; no production SQL was executed."
else
  echo "All approved production migrations have been applied and their exact versions verified."
fi
