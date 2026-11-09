#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIGRATIONS_DIR="${MIGRATIONS_DIR:-$ROOT/supabase/migrations}"
ALLOWLIST="${ALLOWLIST:-$MIGRATIONS_DIR/production-pending-allowlist.txt}"
RECONCILIATION_FILE="${RECONCILIATION_FILE:-$MIGRATIONS_DIR/production-history-reconciliation.tsv}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

LOCAL="$TMP_DIR/local.tsv"
REMOTE="$TMP_DIR/remote.tsv"
REMOTE_VERSIONS="$TMP_DIR/remote-versions.txt"
LOCAL_VERSIONS="$TMP_DIR/local-versions.txt"
LOCAL_ONLY="$TMP_DIR/local-only.txt"
REMOTE_ONLY="$TMP_DIR/remote-only.txt"
NAME_MISMATCH="$TMP_DIR/name-mismatch.txt"
DUPLICATE_LOCAL="$TMP_DIR/duplicate-local.txt"
DUPLICATE_REMOTE="$TMP_DIR/duplicate-remote.txt"
UNEXPECTED="$TMP_DIR/unexpected.txt"
UNMAPPED="$TMP_DIR/unmapped.txt"
USED_MAP="$TMP_DIR/used-map.txt"
ALLOW="$TMP_DIR/allow.txt"

if [[ -n "${REMOTE_LEDGER_FILE:-}" ]]; then
  cp "$REMOTE_LEDGER_FILE" "$REMOTE"
else
  : "${SUPABASE_DB_URL:?SUPABASE_DB_URL is required for the read-only migration ledger check}"
  psql "$SUPABASE_DB_URL" -X -qAt -F '|' \
    -c "select version::text, name from supabase_migrations.schema_migrations order by version" > "$REMOTE"
fi

: > "$LOCAL"
LEGACY_COUNT=0
for file in "$MIGRATIONS_DIR"/*.sql; do
  [[ -f "$file" ]] || continue
  filename="${file##*/}"
  if [[ "$filename" =~ ^([0-9]{14})_(.+)\.sql$ ]]; then
    printf '%s|%s|%s\n' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "$filename" >> "$LOCAL"
  else
    LEGACY_COUNT=$((LEGACY_COUNT + 1))
    printf 'Historical non-versioned file excluded from direct deployment: %s\n' "$filename"
  fi
done
sort -t '|' -k1,1 -o "$LOCAL" "$LOCAL"

if [[ ! -s "$LOCAL" ]]; then
  echo "::error::No timestamped local migrations found"
  exit 1
fi

sort -t '|' -k1,1 -o "$REMOTE" "$REMOTE"
awk -F '|' 'NF != 2 || $1 !~ /^[0-9]{14}$/ || $2 == "" {print "Invalid remote ledger row at line " NR ": " $0; bad=1} END {exit bad}' "$REMOTE"
cut -d '|' -f1 "$LOCAL" | sort > "$LOCAL_VERSIONS"
cut -d '|' -f1 "$REMOTE" | sort > "$REMOTE_VERSIONS"
cut -d '|' -f1 "$LOCAL" | uniq -d > "$DUPLICATE_LOCAL"
cut -d '|' -f1 "$REMOTE" | uniq -d > "$DUPLICATE_REMOTE"

if [[ -s "$DUPLICATE_LOCAL" ]]; then
  echo "::error::Duplicate local migration versions:"
  cat "$DUPLICATE_LOCAL"
  exit 1
fi
if [[ -s "$DUPLICATE_REMOTE" ]]; then
  echo "::error::Duplicate remote migration versions:"
  cat "$DUPLICATE_REMOTE"
  exit 1
fi

comm -23 "$LOCAL_VERSIONS" "$REMOTE_VERSIONS" > "$LOCAL_ONLY"
comm -13 "$LOCAL_VERSIONS" "$REMOTE_VERSIONS" > "$REMOTE_ONLY"
join -t '|' -1 1 -2 1 "$LOCAL" "$REMOTE" \
  | awk -F '|' '$2 != $4 {print $1 " local=" $2 " remote=" $4}' > "$NAME_MISMATCH"

if [[ -f "$ALLOWLIST" ]]; then
  awk 'NF && $1 !~ /^#/ {print $1}' "$ALLOWLIST" | sort -u > "$ALLOW"
else
  : > "$ALLOW"
fi

: > "$UNEXPECTED"
while IFS= read -r version; do
  [[ -n "$version" ]] || continue
  grep -Fxq "$version" "$ALLOW" || printf '%s\n' "$version" >> "$UNEXPECTED"
done < "$LOCAL_ONLY"

: > "$UNMAPPED"
: > "$USED_MAP"
if [[ -f "$RECONCILIATION_FILE" ]]; then
  awk -F '|' '
    NF != 6 || $1 !~ /^[0-9]{14}$/ || $2 == "" || $3 == "" || $4 !~ /^(absorbed|renamed|recovered)$/ || $5 == "" || $6 !~ /^[0-9a-f]{64}$/ {
      if ($0 !~ /^[[:space:]]*#/ && $0 !~ /^[[:space:]]*$/) {
        print "Invalid reconciliation row at line " NR ": " $0
        bad=1
      }
    }
    END {exit bad}
  ' "$RECONCILIATION_FILE"
  awk -F '|' '$1 !~ /^[[:space:]]*#/ && NF {print $1}' "$RECONCILIATION_FILE" | sort | uniq -d > "$TMP_DIR/duplicate-map"
  if [[ -s "$TMP_DIR/duplicate-map" ]]; then
    echo "::error::Duplicate remote versions in reconciliation manifest:"
    cat "$TMP_DIR/duplicate-map"
    exit 1
  fi
fi

while IFS='|' read -r version remote_name local_file mapping_type evidence_ref expected_sha; do
  [[ -n "$version" && "$version" != \#* ]] || continue
  remote_row="$(awk -F '|' -v v="$version" '$1==v {print $2}' "$REMOTE")"
  if [[ -z "$remote_row" || "$remote_row" != "$remote_name" ]]; then
    echo "::error::Reconciliation manifest does not match the remote ledger for $version"
    exit 1
  fi
  if [[ "$local_file" != "$(basename "$local_file")" || "$local_file" != *.sql ]]; then
    echo "::error::Reconciliation source must be a SQL file directly under supabase/migrations: $local_file"
    exit 1
  fi
  local_path="$MIGRATIONS_DIR/$local_file"
  if [[ ! -f "$local_path" ]]; then
    echo "::error::Reconciliation source file is missing for $version: $local_file"
    exit 1
  fi
  actual_sha="$(sha256sum "$local_path" | awk '{print $1}')"
  if [[ "$actual_sha" != "$expected_sha" ]]; then
    echo "::error::Reconciliation source checksum mismatch for $version ($local_file)"
    exit 1
  fi
  printf '%s\n' "$version" >> "$USED_MAP"
done < "$RECONCILIATION_FILE"

: > "$TMP_DIR/name-mismatch-unmapped"
while read -r mismatch_version mismatch_detail; do
  [[ -n "$mismatch_version" ]] || continue
  grep -Fxq "$mismatch_version" "$USED_MAP" || printf '%s %s\n' "$mismatch_version" "$mismatch_detail" >> "$TMP_DIR/name-mismatch-unmapped"
done < "$NAME_MISMATCH"
mv "$TMP_DIR/name-mismatch-unmapped" "$NAME_MISMATCH"

while IFS='|' read -r version remote_name; do
  [[ -n "$version" ]] || continue
  local_row="$(awk -F '|' -v v="$version" '$1==v {print $2}' "$LOCAL")"
  if [[ -z "$local_row" || "$local_row" != "$remote_name" ]]; then
    grep -Fxq "$version" "$USED_MAP" || printf '%s remote=%s local=%s\n' "$version" "$remote_name" "${local_row:-ABSENT}" >> "$UNMAPPED"
  fi
done < "$REMOTE"

echo "Remote migration records: $(wc -l < "$REMOTE" | tr -d ' ')"
echo "Timestamped local SQL files: $(wc -l < "$LOCAL" | tr -d ' ')"
echo "Historical non-versioned SQL files (excluded from direct deployment): $LEGACY_COUNT"
echo "Local versions not recorded remotely: $(wc -l < "$LOCAL_ONLY" | tr -d ' ')"
echo "Allowlisted pending local versions: $(comm -12 "$LOCAL_ONLY" "$ALLOW" | wc -l | tr -d ' ')"
echo "Unreviewed pending local versions: $(wc -l < "$UNEXPECTED" | tr -d ' ')"
echo "Remote versions without a verified local representation: $(wc -l < "$UNMAPPED" | tr -d ' ')"
echo "Same-version name mismatches: $(wc -l < "$NAME_MISMATCH" | tr -d ' ')"
echo "Verified reconciliation manifest entries: $(wc -l < "$USED_MAP" | tr -d ' ')"

if [[ -s "$UNEXPECTED" ]]; then
  echo "::error::Unreviewed local migrations would be applied to production:"
  while IFS= read -r version; do
    grep -F "$version|" "$LOCAL" || true
  done < "$UNEXPECTED"
fi
if [[ -s "$UNMAPPED" ]]; then
  echo "::error::Remote migration history is not represented by local SQL or a checksum-verified reconciliation entry:"
  cat "$UNMAPPED"
fi
if [[ -s "$NAME_MISMATCH" ]]; then
  echo "::error::Same-version migration name mismatches require an explicit verified reconciliation entry:"
  cat "$NAME_MISMATCH"
fi

if [[ -s "$UNEXPECTED" || -s "$UNMAPPED" || -s "$NAME_MISMATCH" ]]; then
  echo "::error::Production migration history is not reconciled. APPLY is blocked."
  exit 1
fi

echo "Migration ledger preflight passed. All remote versions have a verified local representation."
