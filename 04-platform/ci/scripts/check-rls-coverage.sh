#!/usr/bin/env bash
# check-rls-coverage.sh
# Every table created in a migration must have `enable row level
# security` AND at least one policy in the same file. Scans BOTH
# migration dirs: the core schema lives in supabase/migrations
# (0001_initial.sql etc.), later features in 04-platform/migrations.
# POSIX-portable.
set -eu

REPO_ROOT="$(cd "$(dirname "$0")/../../../" && pwd)"

FILES=""
for MIG_DIR in "$REPO_ROOT/supabase/migrations" "$REPO_ROOT/04-platform/migrations"; do
  [ -d "$MIG_DIR" ] || continue
  DIR_FILES=$(find "$MIG_DIR" -name "*.sql" -not -name "_*.sql" | sort)
  [ -z "$DIR_FILES" ] || FILES="$FILES$DIR_FILES
"
done

if [ -z "$FILES" ]; then
  echo "[check-rls] No migration files yet. Skipping."
  exit 0
fi

missing=0
for file in $FILES; do
  rel="${file#$REPO_ROOT/}"
  # Extract all `create table <name>` references.
  tables=$(grep -iE '^\s*create\s+table\s+(if\s+not\s+exists\s+)?[a-zA-Z_][a-zA-Z0-9_]*' "$file" \
    | grep -viE 'create\s+table\s+(or\s+replace|function|trigger)' \
    | sed -E 's/^[[:space:]]*create[[:space:]]+table[[:space:]]+(if[[:space:]]+not[[:space:]]+exists[[:space:]]+)?//I' \
    | awk '{print $1}' \
    | tr -d '"' \
    | sort -u)
  if [ -z "$tables" ]; then
    continue
  fi
  for table in $tables; do
    if ! grep -qiE "alter\s+table\s+${table}\s+enable\s+row\s+level\s+security" "$file"; then
      echo "  [x] $rel -> table $table has no 'enable row level security' in same file"
      missing=$((missing + 1))
    elif ! grep -qiE "create\s+policy.*on\s+${table}\b" "$file"; then
      echo "  [x] $rel -> table $table has no policy in same file"
      missing=$((missing + 1))
    else
      echo "  [ok] $rel -> $table has RLS + policy"
    fi
  done
done

if [ $missing -gt 0 ]; then
  echo
  echo "[check-rls] $missing table(s) missing RLS coverage."
  echo "Add 'alter table X enable row level security' and at least one policy in the same migration."
  exit 1
fi
echo "[check-rls] All tables have RLS."
