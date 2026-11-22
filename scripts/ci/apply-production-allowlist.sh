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
REPLAY_ONLY_FILE="$MIGRATIONS_DIR/production-local-replay-only.txt"
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
if [[ -f "$REPLAY_ONLY_FILE" ]]; then
  while IFS= read -r replay_version; do
    [[ -n "$replay_version" ]] || continue
    if printf '%s\n' "${ALLOWED_VERSIONS[@]}" | grep -Fxq "$replay_version"; then
      echo "::error::Local replay-only migration $replay_version cannot be applied to production."
      exit 1
    fi
  done < <(awk 'NF && $1 !~ /^#/ {print $1}' "$REPLAY_ONLY_FILE")
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# Never apply a missing historical version behind the current remote head.
# Supabase migration versions are fixed-width timestamps, so lexical order is chronological.
REMOTE_MAX_VERSION="$(psql "$SUPABASE_DB_URL" -X -qAt -v ON_ERROR_STOP=1 \
  -c "select coalesce(max(version)::text,'') from supabase_migrations.schema_migrations")"

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

  checksum="$(sha256sum "$file" | awk '{print $1}')"

  # A forward-only local migration may already be applied in production under
  # a separately versioned, checksum-verified ledger entry. Never replay that
  # local file or reject it as out-of-order: verify the exact remote record.
  if [[ -f "$RECONCILIATION_FILE" ]]; then
    mapped_row="$(awk -F '|' -v f="$filename" '$1 !~ /^#/ && $3 == f {print $1 "|" $2 "|" $4 "|" $6}' "$RECONCILIATION_FILE")"
    if [[ -n "$mapped_row" ]]; then
      IFS='|' read -r mapped_version mapped_name mapped_type mapped_sha <<< "$mapped_row"
      if [[ ! "$mapped_version" =~ ^[0-9]{14}$ || ! "$mapped_name" =~ ^[a-z0-9_]+$ || ! "$mapped_sha" =~ ^[0-9a-f]{64}$ ]]; then
        echo "::error::Invalid production reconciliation mapping for $filename"
        exit 1
      fi
      if [[ "$checksum" != "$mapped_sha" ]]; then
        echo "::error::Local SQL checksum does not match reconciliation mapping for $filename"
        exit 1
      fi
      mapped_remote="$(psql "$SUPABASE_DB_URL" -X -qAt -F '|' -v ON_ERROR_STOP=1 \
        -c "select version::text, coalesce(name,''), encode(digest(convert_to(case when cardinality(statements)=1 and left(statements[1],1)=',' then substr(statements[1],2) else array_to_string(statements,chr(10)) end,'UTF8'),'sha256'),'hex') from supabase_migrations.schema_migrations where version = '$mapped_version'")"
      if [[ "$mapped_remote" != "$mapped_version|$mapped_name|$mapped_sha" ]]; then
        echo "::error::Reconciled production record is absent or differs for $filename (expected $mapped_version $mapped_name with verified SQL checksum)"
        exit 1
      fi
      echo "Already applied through verified production reconciliation: $version -> $mapped_version $mapped_name"
      continue
    fi
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

  if [[ -n "$REMOTE_MAX_VERSION" && "$version" < "$REMOTE_MAX_VERSION" ]]; then
    echo "::error::Refusing out-of-order migration $version: remote ledger already contains $REMOTE_MAX_VERSION."
    echo "::error::Create and validate a forward-only compatibility migration after the remote ledger head."
    exit 1
  fi

  printf 'Pending approved migration: %s %s sha256=%s\n' "$version" "$expected_name" "$checksum"
  PENDING=$((PENDING + 1))

  if [[ "$MODE" == "apply" ]]; then
    # Preserve the exact repository migration version in Supabase's ledger.
    # The CLI cannot push a reviewed subset while the historic production
    # ledger contains remote-only versions. Execute one allowlisted file per
    # transaction and record that exact version in the same transaction.
    tag="\$magnisa_migration_${version}\$"
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

    test -s "$wrapper" || { echo "::error::Migration transaction wrapper was not generated."; exit 1; }
    # The production backup workflow may provide psql through Docker. Feed SQL
    # on stdin so the client can read the host-generated temporary wrapper.
    psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 < "$wrapper"
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
