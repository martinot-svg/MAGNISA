#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL is required}"
ROOT="${GITHUB_WORKSPACE:-$(pwd)}"
MANIFEST="$ROOT/supabase/production-migrations.txt"
WORKDIR="${RUNNER_TEMP:-/tmp}/magnisa-production-migrations"
REMOTE_HISTORY="$WORKDIR/remote-history.txt"
REMOTE_VERSIONS="$WORKDIR/remote-versions.txt"
MIGRATION_DIR="$WORKDIR/supabase/migrations"

if [[ ! -f "$MANIFEST" ]]; then
  echo "::error::Production migration allowlist not found: $MANIFEST"
  exit 1
fi
if [[ ! -f "$ROOT/supabase/config.toml" ]]; then
  echo "::error::supabase/config.toml not found"
  exit 1
fi

rm -rf "$WORKDIR"
mkdir -p "$MIGRATION_DIR"
cp "$ROOT/supabase/config.toml" "$WORKDIR/supabase/config.toml"

# Read the actual Production ledger. Do not repair or mutate it here.
psql "$SUPABASE_DB_URL" -X -A -t -F '|' -v ON_ERROR_STOP=1 \
  -c "select version, name from supabase_migrations.schema_migrations order by version" \
  > "$REMOTE_HISTORY"

if [[ ! -s "$REMOTE_HISTORY" ]]; then
  echo "::error::Production migration ledger is empty or inaccessible; refusing to construct a deployment workdir."
  exit 1
fi

: > "$REMOTE_VERSIONS"
while IFS='|' read -r version name; do
  [[ "$version" =~ ^[0-9]{14}$ ]] || {
    echo "::error::Invalid Production migration version: $version"
    exit 1
  }
  [[ "$name" =~ ^[A-Za-z0-9_-]+$ ]] || {
    echo "::error::Unsafe Production migration name for version $version"
    exit 1
  }
  if grep -Fxq "$version" "$REMOTE_VERSIONS"; then
    echo "::error::Duplicate Production migration version: $version"
    exit 1
  fi
  printf '%s\n' "$version" >> "$REMOTE_VERSIONS"

  # A no-op local placeholder preserves the already-applied remote version.
  # The historical SQL is not re-executed and the remote ledger is untouched.
  cat > "$MIGRATION_DIR/${version}_${name}.sql" <<'SQL'
-- Production history bridge only.
-- This version is already recorded as applied in the target database.
-- Do not put executable historical SQL in this placeholder.
SELECT 1;
SQL
done < "$REMOTE_HISTORY"

pending_count=0
while IFS= read -r migration || [[ -n "$migration" ]]; do
  migration="${migration%%#*}"
  migration="$(printf '%s' "$migration" | xargs)"
  [[ -z "$migration" ]] && continue

  [[ "$migration" == supabase/migrations/* ]] || {
    echo "::error::Manifest entry must be a path under supabase/migrations: $migration"
    exit 1
  }
  file="$ROOT/$migration"
  [[ -f "$file" ]] || {
    echo "::error::Manifest migration file does not exist: $migration"
    exit 1
  }

  base="$(basename "$file" .sql)"
  version="${base:0:14}"
  [[ "$version" =~ ^[0-9]{14}$ ]] || {
    echo "::error::Manifest migration must start with a 14-digit version: $migration"
    exit 1
  }

  if grep -Fxq "$version" "$REMOTE_VERSIONS"; then
    echo "Already applied in Production; not copied: $migration"
    continue
  fi

  if [[ -e "$MIGRATION_DIR/$base.sql" ]]; then
    echo "::error::Duplicate migration version in production workdir: $base"
    exit 1
  fi

  cp "$file" "$MIGRATION_DIR/$base.sql"
  pending_count=$((pending_count + 1))
  echo "Pending Production migration included: $migration"
done < "$MANIFEST"

echo "Production history versions represented: $(wc -l < "$REMOTE_VERSIONS" | tr -d ' ')"
echo "Pending Production migrations included: $pending_count"
echo "Migration workdir: $WORKDIR"

if [[ -n "${GITHUB_ENV:-}" ]]; then
  printf 'MIGRATION_WORKDIR=%s\n' "$WORKDIR" >> "$GITHUB_ENV"
fi
