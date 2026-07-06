#!/usr/bin/env bash
# check-no-todo.sh
# No TODO / FIXME / XXX / HACK in shipped code (per AGENTS.md rule 4).
# Allowed in: docs/, 00-foundations/*/README.md, STUBS.md, node_modules.
# POSIX-portable.
set -eu

REPO_ROOT="$(cd "$(dirname "$0")/../../../" && pwd)"

FILES=$(find "$REPO_ROOT" \
  \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" -o -name "*.css" -o -name "*.sql" \) \
  -not -path "*/node_modules/*" \
  -not -path "*/.next/*" \
  -not -path "*/dist/*" \
  -not -path "*/coverage/*" \
  -not -path "*/demo/*" \
  -not -path "*/mockups/*" \
  | sort)

if [ -z "$FILES" ]; then
  echo "[check-no-todo] No source files to scan."
  exit 0
fi

# Patterns we ban in shipped code.
pattern='\b(TODO|FIXME|XXX|HACK)\b'
# Loose "later / for now" trailing a line.
context_pattern='//[[:space:]]*(for[[:space:]]*now|later)[[:space:]]*$'

violations=0
for file in $FILES; do
  rel="${file#$REPO_ROOT/}"
  # Allow docs to mention the words.
  case "$rel" in
    */README.md|*/PHASES.md|*/STUBS.md|*/AGENTS.md) continue ;;
  esac
  # References to the audit backlog doc "TODO-HARDENING.md" are
  # legitimate citations, not placeholders — strip the doc name before
  # matching so a real TODO on the same line still flags.
  if sed 's/TODO-HARDENING//g' "$file" | grep -nE "$pattern" > /dev/null 2>&1; then
    echo "  [x] $rel"
    sed 's/TODO-HARDENING//g' "$file" | grep -nE "$pattern" | head -3 | sed 's/^/      /'
    violations=$((violations + 1))
  fi
  if grep -nE "$context_pattern" "$file" > /dev/null 2>&1; then
    echo "  [x] $rel (loose 'later/for now')"
    grep -nE "$context_pattern" "$file" | head -3 | sed 's/^/      /'
    violations=$((violations + 1))
  fi
done

if [ $violations -gt 0 ]; then
  echo
  echo "[check-no-todo] $violations file(s) contain banned placeholders."
  echo "Either fix the code or add a follow-up entry in STUBS.md."
  exit 1
fi
echo "[check-no-todo] Clean."
