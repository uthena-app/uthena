#!/usr/bin/env bash
# check-pii-logs.sh
# Detect common PII patterns being logged or sent to the client.
# POSIX-portable.
set -eu

REPO_ROOT="$(cd "$(dirname "$0")/../../../" && pwd)"

FILES=$(find "$REPO_ROOT" \
  \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" \) \
  -not -path "*/node_modules/*" \
  -not -path "*/.next/*" \
  -not -path "*/dist/*" \
  -not -path "*/coverage/*" \
  -not -path "*/test/*" \
  -not -path "*/tests/*" \
  -not -path "*/demo/*" \
  -not -path "*/mockups/*" \
  | sort)

if [ -z "$FILES" ]; then
  echo "[check-pii] No source files to scan."
  exit 0
fi

violations=0
for file in $FILES; do
  rel="${file#$REPO_ROOT/}"
  case "$rel" in
    *test*|*spec*|*\.test.*|*\.spec.*) continue ;;
  esac

  if grep -nE 'console\.(log|info|warn|error|debug)\([^)]*(\.email\b|password|token|secret)' "$file" > /dev/null 2>&1; then
    echo "  [x] $rel: console.* with .email/password/token/secret"
    violations=$((violations + 1))
  fi
  if grep -nE '(logger|log|pino)\.[a-z]+\([^)]*(\.email\b|password|secret)' "$file" > /dev/null 2>&1; then
    echo "  [x] $rel: logger.* with .email/password/secret"
    violations=$((violations + 1))
  fi
  if grep -nE 'console\.(log|info|warn|error)' "$file" | grep -E '\b[0-9]{4}[- ]?[0-9]{4}[- ]?[0-9]{4}[- ]?[0-9]{4}\b' > /dev/null 2>&1; then
    echo "  [x] $rel: console.* with card-shaped number"
    violations=$((violations + 1))
  fi
  if grep -nE '(logger|log|pino)\.[a-z]+\(' "$file" | grep -E '\b[0-9]{3}-[0-9]{2}-[0-9]{4}\b' > /dev/null 2>&1; then
    echo "  [x] $rel: logger.* with SSN-shaped number"
    violations=$((violations + 1))
  fi
done

if [ $violations -gt 0 ]; then
  echo
  echo "[check-pii] $violations PII risk(s) found."
  echo "Mask emails, redact tokens, hash IDs. See 00-foundations/log/pino.ts (PH02)."
  exit 1
fi
echo "[check-pii] Clean."
