#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL is required for the read-only migration ledger check}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIGRATIONS_DIR="$ROOT/supabase/migrations"
ALLOWLIST="$MIGRATIONS_DIR/production-pending-allowlist.txt"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

LOCAL="$TMP_DIR/local.tsv"
REMOTE="$TMP_DIR/remote.tsv"
LOCAL_VERSIONS="$TMP_DIR/local-versions.txt"
REMOTE_VERSIONS="$TMP_DIR/remote-versions.txt"
LOCAL_ONLY="$TMP_DIR/local-only.txt"
UNEXPECTED="$TMP_DIR/unexpected.txt"
NAME_MISMATCH="$TMP_DIR/name-mismatch.txt"
ALLOW="$TMP_DIR/allowlist.txt"

for file in "$MIGRATIONS_DIR"/*.sql; do
  [ -f "$file" ] || continue
  filename="${file##*/}"
  version="${filename%%_*}"
  name="${filename#*_}"
  name="${name%.sql}"
  if [[ ! "$version" =~ ^[0-9]{14}$ ]]; then
    echo "::error::Invalid migration filename: $filename"
    exit 1
  fi
  printf '%s|%s\n' "$version" "$name"
done | sort -t '|' -k1,1 > "$LOCAL"

psql "$SUPABASE_DB_URL" -X -qAt -F '|' \
  -c "select version::text, name from supabase_migrations.schema_migrations order by version" \
  | sort -t '|' -k1,1 > "$REMOTE"

cut -d '|' -f1 "$LOCAL" | sort -u > "$LOCAL_VERSIONS"
cut -d '|' -f1 "$REMOTE" | sort -u > "$REMOTE_VERSIONS"
comm -23 "$LOCAL_VERSIONS" "$REMOTE_VERSIONS" > "$LOCAL_ONLY"

if [ -f "$ALLOWLIST" ]; then
  awk 'NF && $1 !~ /^#/ {print $1}' "$ALLOWLIST" | sort -u > "$ALLOW"
else
  : > "$ALLOW"
fi

: > "$UNEXPECTED"
while IFS= read -r version; do
  [ -n "$version" ] || continue
  if ! grep -Fxq "$version" "$ALLOW"; then
    printf '%s\n' "$version" >> "$UNEXPECTED"
  fi
done < "$LOCAL_ONLY"

join -t '|' -1 1 -2 1 "$LOCAL" "$REMOTE" \
  | awk -F '|' '$2 != $3 {print $1 " local=" $2 " remote=" $3}' > "$NAME_MISMATCH"

echo "Local migration files: $(wc -l < "$LOCAL" | tr -d ' ')"
echo "Remote migration records: $(wc -l < "$REMOTE" | tr -d ' ')"
echo "Local versions not recorded remotely: $(wc -l < "$LOCAL_ONLY" | tr -d ' ')"
echo "Allowlisted pending versions: $(comm -12 "$LOCAL_ONLY" "$ALLOW" | wc -l | tr -d ' ')"
echo "Unexpected pending versions: $(wc -l < "$UNEXPECTED" | tr -d ' ')"
echo "Same-version name mismatches: $(wc -l < "$NAME_MISMATCH" | tr -d ' ')"
echo "Remote-only historical versions are reported by Supabase CLI and are not treated as pending local migrations."

if [ -s "$UNEXPECTED" ]; then
  echo "::error::Unreviewed local migrations would be applied to production:"
  while IFS= read -r version; do
    grep -F "$version|" "$LOCAL" || true
  done < "$UNEXPECTED"
fi

if [ -s "$NAME_MISMATCH" ]; then
  echo "::error::Migration version/name mismatches:"
  cat "$NAME_MISMATCH"
fi

if [ -s "$UNEXPECTED" ] || [ -s "$NAME_MISMATCH" ]; then
  echo "::error::Production migration history is not reconciled. APPLY is blocked."
  exit 1
fi

echo "Migration ledger preflight passed. Only explicitly allowlisted pending migrations remain."
