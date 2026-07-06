#!/usr/bin/env bash
# check-enum-coverage.sh
# Every Postgres CREATE TYPE ... AS ENUM + every text column with a
# CHECK (... IN (...)) constraint must be mirrored in
# 00-foundations/data/enums.ts with a matching TS type + runtime array.
# Bi-directional check (every DB value in TS + every TS value in DB).
# POSIX-portable (macOS bash 3 + zsh + BSD awk).
#
# Companion script: 04-platform/ci/scripts/check-rls-coverage.sh
# (same pattern, RLS surface).
set -eu

REPO_ROOT="$(cd "$(dirname "$0")/../../../" && pwd)"
MIG_DIR="$REPO_ROOT/04-platform/migrations"
ENUMS_FILE="$REPO_ROOT/00-foundations/data/enums.ts"
AUDIT_DOC="$REPO_ROOT/04-platform/migrations/ENUM-AUDIT.md"

if [ ! -d "$MIG_DIR" ]; then
  echo "[check-enum] No migrations dir. Skipping."
  exit 0
fi
if [ ! -f "$ENUMS_FILE" ]; then
  echo "[check-enum] No enums.ts file. Skipping."
  exit 0
fi

# ---------------------------------------------------------------------------
# 1. Parse migrations → DB enum values + CHECK constraint values.
# ---------------------------------------------------------------------------
#
# We extract:
#   - CREATE TYPE <name> AS ENUM ('a', 'b', ...) → "name:a,b,..."
#   - ALTER TYPE <name> ADD VALUE 'x' → append to the type's values
#   - CHECK (col IN ('a', 'b', ...)) on text columns → "<table>.<col>:a,b,..."
#
# Output is a flat "<key>\t<value>" stream where key is either:
#   - The Postgres type name (e.g. `order_status`)
#   - The `<table>.<column>` for CHECK constraints
#
# POSIX-portable awk (no GNU extensions). Multi-line ENUM definitions
# are handled via a state machine that tracks "we are inside an ENUM
# declaration" across lines.

DB_VALUES=$(mktemp)
TS_VALUES=$(mktemp)
MAPPING_FILE=$(mktemp)
trap 'rm -f "$DB_VALUES" "$TS_VALUES" "$MAPPING_FILE"' EXIT

# --- DB side: Postgres ENUMs + CHECK constraints -----------------------
# Read all migration files as a single stream with filenames.
# We do two passes: ENUM types first, CHECK constraints second.

# Pass 1: extract CREATE TYPE / ALTER TYPE entries.
# Multi-line aware via a sentinel STATE variable.
awk '
  BEGIN { in_enum = 0; current_type = "" }
  {
    line = $0
    # Strip leading whitespace for easier matching.
    sub(/^[ \t]+/, "", line)

    if (in_enum == 0 && line ~ /^create[ \t]+type[ \t]+[a-z_][a-z0-9_]*[ \t]+as[ \t]+enum[ \t]*\(/) {
      # Extract type name.
      current_type = line
      sub(/^create[ \t]+type[ \t]+/, "", current_type)
      sub(/[ \t]+as[ \t]+enum[ \t]*\(.*/, "", current_type)
      in_enum = 1
      # Extract single-quoted values from the current line.
      extract_values(line)
      # If the enum closes on the same line (single-line form), reset.
      if (line ~ /\)[ \t]*;/) {
        in_enum = 0
        current_type = ""
      }
      next
    }
    if (in_enum == 1) {
      extract_values(line)
      if (line ~ /\)[ \t]*;/) {
        in_enum = 0
        current_type = ""
      }
      next
    }
    # ALTER TYPE X ADD VALUE (if not exists) — single-line pattern.
    if (line ~ /^alter[ \t]+type[ \t]+[a-z_][a-z0-9_]*[ \t]+add[ \t]+value/) {
      alt_type = line
      sub(/^alter[ \t]+type[ \t]+/, "", alt_type)
      sub(/[ \t]+add[ \t]+value.*/, "", alt_type)
      extract_values_as(line, alt_type)
      next
    }
  }
  function extract_values(s,    parts, n, i, v) {
    n = split(s, parts, "\047")
    for (i = 2; i <= n; i += 2) {
      v = parts[i]
      gsub(/[ \t,()]/, "", v)
      if (v != "") print current_type "\t" v
    }
  }
  function extract_values_as(s, t,    parts, n, i, v) {
    n = split(s, parts, "\047")
    for (i = 2; i <= n; i += 2) {
      v = parts[i]
      gsub(/[ \t,]/, "", v)
      if (v != "") print t "\t" v
    }
  }
' "$MIG_DIR"/*.sql > "$DB_VALUES"

# Pass 2: extract CHECK (col IN ('a', 'b', ...)) constraints on text
# columns. We handle three patterns:
#   1. Inline: `col type check (col in (...))` — appears inside a CREATE TABLE
#   2. Top-level: `check (col in (...))` — appears as a separate ALTER TABLE line
#   3. Multi-line: `check (` opens, `)` closes — values spread across lines
#
# We track the current table context (the most recent CREATE TABLE or
# ALTER TABLE) and use it as the table prefix for inline CHECKs.
awk '
  BEGIN { current_table = ""; in_check = 0; check_col = ""; check_buf = "" }
  {
    line = $0

    # Track table context from CREATE TABLE.
    if (line ~ /^[ \t]*create[ \t]+table[ \t]+/) {
      t = line
      sub(/^[ \t]*create[ \t]+table[ \t]+(if[ \t]+not[ \t]+exists[ \t]+)?/, "", t)
      sub(/[ \t\(].*/, "", t)
      if (t != "") current_table = t
    }
    # Track table context from ALTER TABLE.
    if (line ~ /^[ \t]*alter[ \t]+table[ \t]+/) {
      t = line
      sub(/^[ \t]*alter[ \t]+table[ \t]+/, "", t)
      sub(/[ \t\(].*/, "", t)
      if (t != "") current_table = t
    }

    # Multi-line CHECK continuation.
    if (in_check == 1) {
      check_buf = check_buf " " line
      if (check_buf ~ /\)[ \t]*[,;]/ || check_buf ~ /\)[ \t]*--/ || check_buf ~ /\)[ \t]*\)/) {
        flush_check()
      }
      next
    }

    # Inline CHECK (inside a CREATE TABLE column definition).
    # Pattern: `col_name type [not null] check (col_name in (values))`
    # We look for the `check (` substring anywhere in the line (with a
    # word boundary so `checkup` etc. don'\''t trigger).
    if (line ~ /[ \t]check[ \t]*\([a-z_][a-z0-9_]*[ \t]+in[ \t]*\(/) {
      # Extract the column name from the `check (col in (` substring.
      col = line
      sub(/.*[ \t]check[ \t]*\(/, "", col)
      sub(/[ \t]+in[ \t]*\(.*/, "", col)
      check_col = col
      check_buf = line
      if (check_buf ~ /\)[ \t]*[,;]/ || check_buf ~ /\)[ \t]*--/ || check_buf ~ /\)[ \t]*\)/) {
        flush_check()
      } else {
        in_check = 1
      }
      next
    }
  }
  function flush_check(    parts, n, i, v) {
    if (current_table == "" || check_col == "") {
      in_check = 0
      check_buf = ""
      check_col = ""
      return
    }
    n = split(check_buf, parts, "\047")
    for (i = 2; i <= n; i += 2) {
      v = parts[i]
      gsub(/[ \t,]/, "", v)
      if (v != "") print current_table "." check_col "\t" v
    }
    in_check = 0
    check_buf = ""
    check_col = ""
  }
' "$MIG_DIR"/*.sql >> "$DB_VALUES"

# --- TS side: parse enums.ts runtime arrays ----------------------------
# Multi-line aware. Extract every `export const NAME: readonly T[] = [...]`
# block. The closing pattern handles three shapes:
#   - `]` (single-line array with just the bracket)
#   - `] as const` (the canonical multi-line form)
#   - `,` followed by anything (the next array starts; reset state)
awk '
  BEGIN { in_const = 0; current_const = "" }
  {
    line = $0

    if (in_const == 0 && line ~ /^export[ \t]+const[ \t]+[A-Z][A-Z0-9_]*[ \t]*:[ \t]*readonly[ \t]+/) {
      # Extract the const name.
      current_const = line
      sub(/^export[ \t]+const[ \t]+/, "", current_const)
      sub(/[ \t]*:.*/, "", current_const)
      in_const = 1
      extract_ts_values(line)
      # Did the array close on this line? `]`, `] as const`, or `],`.
      if (line ~ /\][[:space:]]*$/ || line ~ /\][[:space:]]+as[[:space:]]+const[[:space:]]*$/) {
        in_const = 0
        current_const = ""
      }
      next
    }
    if (in_const == 1) {
      extract_ts_values(line)
      # Detect end of array: a line that is `]`, `] as const`, or `],`.
      if (line ~ /\][[:space:]]*$/ || line ~ /\][[:space:]]+as[[:space:]]+const[[:space:]]*$/) {
        in_const = 0
        current_const = ""
      }
    }
  }
  function extract_ts_values(s,    parts, n, i, v) {
    n = split(s, parts, "\047")
    for (i = 2; i <= n; i += 2) {
      v = parts[i]
      gsub(/[ \t,]/, "", v)
      if (v != "" && current_const != "") print current_const "\t" v
    }
  }
' "$ENUMS_FILE" > "$TS_VALUES"

# ---------------------------------------------------------------------------
# 2. Mapping table: DB key → TS runtime array name.
# ---------------------------------------------------------------------------
cat > "$MAPPING_FILE" <<'EOF'
# Format: <db-key><TAB><ts-array-name>
user_role	USER_ROLES
user_status	USER_STATUSES
partner_status	PARTNER_STATUSES
partners.tax_form_status	PARTNER_TAX_FORM_STATUSES
partners.kyc_status	PARTNER_KYC_STATUSES
affiliates.status	AFFILIATE_STATUSES
product_kind	PRODUCT_KINDS
product_status	PRODUCT_STATUSES
license_type	LICENSE_TIERS
file_kind	FILE_KINDS
scan_status	SCAN_STATUSES
encoding_status	ENCODING_STATUSES
product_images.kind	PRODUCT_IMAGE_KINDS
cart_status	CART_STATUSES
order_status	ORDER_STATUSES
refund_status	REFUND_STATUSES
refunds.reason	REFUND_REASONS
subscription_status	SUBSCRIPTION_STATUSES
library_grants.source	LIBRARY_GRANT_SOURCES
file_downloads.kind	FILE_DOWNLOAD_KINDS
reviews.status	REVIEW_STATUSES
collections.status	COLLECTION_STATUSES
payout_ledger_kind	PAYOUT_LEDGER_KINDS
payout_ledger_status	PAYOUT_LEDGER_STATUSES
processed_webhooks.source	WEBHOOK_SOURCES
processed_webhooks.result	WEBHOOK_RESULTS
risk_signals.severity	RISK_SIGNAL_SEVERITIES
reports.target_kind	MODERATION_TARGET_KINDS
reports.status	MODERATION_STATUSES
reports.reason	MODERATION_REASONS
dmca_takedowns.target_kind	DMCA_TARGET_KINDS
dmca_takedowns.status	DMCA_STATUSES
auth_failed_attempts.kind	AUTH_FAILURE_KINDS
auth_failed_attempts.reason	AUTH_FAILURE_REASONS
partner_uploads.failure_kind	FAILURE_KINDS
EOF

# Strip comments + blank lines from the mapping.
grep -v '^[[:space:]]*#' "$MAPPING_FILE" | grep -v '^[[:space:]]*$' > "${MAPPING_FILE}.clean"
mv "${MAPPING_FILE}.clean" "$MAPPING_FILE"

# ---------------------------------------------------------------------------
# 3. Bi-directional comparison.
# ---------------------------------------------------------------------------
missing_in_ts=0
missing_in_db=0

echo "[check-enum] Bi-directional ENUM coverage check (DB ↔ TS)..."

while IFS="$(printf '\t')" read -r db_key ts_name; do
  db_values=$(awk -F'\t' -v key="$db_key" '$1 == key { print $2 }' "$DB_VALUES" | sort -u)
  ts_values=$(awk -F'\t' -v key="$ts_name" '$1 == key { print $2 }' "$TS_VALUES" | sort -u)

  # Compare: every DB value must be in TS.
  for v in $db_values; do
    if [ -n "$v" ] && ! printf '%s\n' "$ts_values" | grep -qx "$v"; then
      echo "  [x] $db_key -> value '$v' is in DB but missing from $ts_name in enums.ts"
      missing_in_ts=$((missing_in_ts + 1))
    fi
  done

  # Compare: every TS value must be in DB.
  for v in $ts_values; do
    if [ -n "$v" ] && ! printf '%s\n' "$db_values" | grep -qx "$v"; then
      echo "  [x] $db_key -> value '$v' is in $ts_name but missing from DB (no migration defines it)"
      missing_in_db=$((missing_in_db + 1))
    fi
  done
done < "$MAPPING_FILE"

# ---------------------------------------------------------------------------
# 4. Coverage stats.
# ---------------------------------------------------------------------------
db_total=$(awk '{n++} END {print n+0}' "$DB_VALUES")
ts_total=$(awk '{n++} END {print n+0}' "$TS_VALUES")
mapped=$(awk '{n++} END {print n+0}' "$MAPPING_FILE")

echo
echo "[check-enum] Coverage:"
echo "  DB enum values discovered:  $db_total"
echo "  TS enum values discovered:  $ts_total"
echo "  Mapped keys:                $mapped"

if [ "$missing_in_ts" -gt 0 ] || [ "$missing_in_db" -gt 0 ]; then
  echo
  echo "[check-enum] FAIL: $missing_in_ts DB value(s) missing from TS, $missing_in_db TS value(s) missing from DB."
  echo
  echo "Add the missing values to 00-foundations/data/enums.ts (the runtime array + the TS type),"
  echo "or update the mapping table in 04-platform/ci/scripts/check-enum-coverage.sh."
  echo
  if [ -f "$AUDIT_DOC" ]; then
    echo "See ENUM-AUDIT.md for the full inventory and deprecation strategy."
  fi
  exit 1
fi

echo "[check-enum] All mapped DB enum values are present in TS, and vice versa."
exit 0