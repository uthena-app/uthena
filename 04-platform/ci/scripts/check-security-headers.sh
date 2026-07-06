#!/usr/bin/env bash
# check-security-headers.sh
#
# Boots the Next.js dev server, curls representative routes, and
# asserts the security headers expected at each route kind. Fails the
# build if any expected header is missing or has the wrong value.
#
# The routes and expected headers are derived from
# `00-foundations/security/headers.ts` (the single source of truth).
# Per-route variant table: `01-specs/pages/security-headers.md`.
#
# Routes tested (representative coverage for every variant):
#   /                          → html
#   /products/missing          → html (404 surface; still html)
#   /sitemap.xml               → xml
#   /og?title=Test             → image
#   /robots.txt                → text
#   /api/search?q=test         → json
#   /api/files/1/download      → binary (anon → 401, but headers applied)
#   /api/webhooks/stripe       → webhook (no body, but headers applied)
#   /healthz                   → health (NOT matched by middleware — baseline
#                                 check that the route still exists)
#   /api/health                → health (NOT matched by middleware)
#
# The dev server runs on port 3101 (different from the default 3100
# so it doesn't collide with a running dev server).
#
# Design note: each URL is fetched ONCE, the headers are cached in a
# bash variable, and every assertion inspects that cached value. This
# avoids re-triggering Next.js's per-route recompile (~7s the first
# time + ~1s on cold) on every assert. Same headers, far fewer
# requests.
#
# POSIX-portable (macOS bash 3 + zsh).

set -eu

REPO_ROOT="$(cd "$(dirname "$0")/../../../" && pwd)"
cd "$REPO_ROOT"

PORT=3101
BASE_URL="http://127.0.0.1:${PORT}"
LOG="/tmp/check-security-headers-dev.log"
DEV_PID=""

cleanup() {
  if [ -n "$DEV_PID" ] && kill -0 "$DEV_PID" 2>/dev/null; then
    kill "$DEV_PID" 2>/dev/null || true
    # Don't wait — we're exiting.
  fi
}
trap cleanup EXIT

# Start dev server in the background. We invoke `next dev` directly
# (not via `pnpm dev`) so we can pass our own port. The `pnpm dev`
# script hardcodes `-p 3100` for normal development; the CI script
# uses port 3101 to avoid colliding with a running dev server.
echo "[check-security-headers] Starting dev server on port ${PORT}..."
pnpm exec next dev -p "$PORT" >"$LOG" 2>&1 &
DEV_PID=$!

# Wait for the server to be ready — poll the /api/health endpoint
# (which is excluded from middleware, so it's the cheapest ready check).
ready=0
for i in $(seq 1 60); do
  if curl -sf -o /dev/null "$BASE_URL/api/health" 2>/dev/null; then
    ready=1
    break
  fi
  sleep 1
done

if [ "$ready" -ne 1 ]; then
  echo "[check-security-headers] Dev server did not become ready in 60s."
  echo "Last 30 lines of dev log:"
  tail -30 "$LOG" || true
  exit 1
fi

# Helper: curl with -D - to capture headers, write them to stdout.
# Returns the response headers (sans body) on stdout.
fetch_headers() {
  local url="$1"
  curl -sS -o /dev/null -D - "$url" 2>/dev/null || true
}

fail_count=0

# --- Assertion helpers ---
# Each takes the cached `$headers` (a multi-line string of "Header: value"
# lines) and the expected/header name.

assert_header_present() {
  local label="$1"
  local url="$2"
  local header="$3"
  local headers="$4"
  if printf '%s' "$headers" | grep -qiE "^${header}:"; then
    echo "  [ok] ${label}  ${url}  has ${header}"
  else
    echo "  [FAIL] ${label}  ${url}  missing ${header}"
    fail_count=$((fail_count + 1))
  fi
}

assert_header_absent() {
  local label="$1"
  local url="$2"
  local header="$3"
  local headers="$4"
  if printf '%s' "$headers" | grep -qiE "^${header}:"; then
    echo "  [FAIL] ${label}  ${url}  unexpectedly has ${header}"
    fail_count=$((fail_count + 1))
  else
    echo "  [ok] ${label}  ${url}  correctly omits ${header}"
  fi
}

assert_header_value() {
  local label="$1"
  local url="$2"
  local header="$3"
  local expected="$4"
  local headers="$5"
  local actual
  actual="$(printf '%s' "$headers" | grep -iE "^${header}:" | head -1 | sed -E "s/^[^:]+:[[:space:]]*//" | tr -d '\r\n')"
  if [ "$actual" = "$expected" ]; then
    echo "  [ok] ${label}  ${url}  ${header}: ${expected}"
  else
    echo "  [FAIL] ${label}  ${url}  ${header} expected '${expected}' got '${actual}'"
    fail_count=$((fail_count + 1))
  fi
}

# CSP value is too long for a literal here; check for a substring.
assert_csp_directive() {
  local label="$1"
  local url="$2"
  local directive="$3"
  local headers="$4"
  local csp
  csp="$(printf '%s' "$headers" | grep -iE '^content-security-policy:' | head -1 | sed -E 's/^[^:]+:[[:space:]]*//' | tr -d '\r\n')"
  case "$csp" in
    *"$directive"*)
      echo "  [ok] ${label}  ${url}  CSP contains '${directive}'"
      ;;
    *)
      echo "  [FAIL] ${label}  ${url}  CSP missing '${directive}'"
      fail_count=$((fail_count + 1))
      ;;
  esac
}

echo "[check-security-headers] Fetching representative routes (one curl per URL)..."

# Fetch each URL ONCE. Subsequent assertions inspect the cached `$headers`.
# The `|| true` keeps `set -e` from bailing on a non-2xx HTTP status —
# 401 on /api/files/[id]/download is the expected auth-gate response,
# and the security headers are still set on that 401 response.
HEADERS_ROOT="$(fetch_headers "$BASE_URL/")"
HEADERS_PROD_MISSING="$(fetch_headers "$BASE_URL/products/missing")"
HEADERS_OG="$(fetch_headers "$BASE_URL/og?title=Test")"
HEADERS_SITEMAP="$(fetch_headers "$BASE_URL/sitemap.xml")"
HEADERS_ROBOTS="$(fetch_headers "$BASE_URL/robots.txt")"
HEADERS_SEARCH="$(fetch_headers "$BASE_URL/api/search?q=test")"
HEADERS_DOWNLOAD="$(fetch_headers "$BASE_URL/api/files/1/download")"
HEADERS_WEBHOOK="$(fetch_headers "$BASE_URL/api/webhooks/stripe")"
HEADERS_HEALTHZ="$(fetch_headers "$BASE_URL/healthz")"
HEADERS_API_HEALTH="$(fetch_headers "$BASE_URL/api/health")"

echo "[check-security-headers] Testing route variants..."

# 1) HTML page variant — root + /products/missing.
html_label="html(/, /products/missing)"
html_pairs=(
  "$BASE_URL/|$HEADERS_ROOT"
  "$BASE_URL/products/missing|$HEADERS_PROD_MISSING"
)
for pair in "${html_pairs[@]}"; do
  url="${pair%|*}"
  headers="${pair#*|}"
  assert_header_present "$html_label" "$url" "Content-Security-Policy" "$headers"
  assert_header_present "$html_label" "$url" "Strict-Transport-Security" "$headers"
  assert_header_present "$html_label" "$url" "X-Frame-Options" "$headers"
  assert_header_present "$html_label" "$url" "Permissions-Policy" "$headers"
  assert_header_present "$html_label" "$url" "Cross-Origin-Opener-Policy" "$headers"
  assert_header_present "$html_label" "$url" "Cross-Origin-Resource-Policy" "$headers"
  assert_header_present "$html_label" "$url" "Origin-Agent-Cluster" "$headers"
  assert_header_present "$html_label" "$url" "X-Content-Type-Options" "$headers"
  assert_header_present "$html_label" "$url" "X-DNS-Prefetch-Control" "$headers"
  assert_header_present "$html_label" "$url" "Referrer-Policy" "$headers"
  assert_header_value "$html_label" "$url" "X-Frame-Options" "DENY" "$headers"
  assert_header_value "$html_label" "$url" "X-Content-Type-Options" "nosniff" "$headers"
  assert_header_value "$html_label" "$url" "X-DNS-Prefetch-Control" "off" "$headers"
  assert_header_value "$html_label" "$url" "Referrer-Policy" "strict-origin-when-cross-origin" "$headers"
  assert_header_value "$html_label" "$url" "Strict-Transport-Security" "max-age=63072000; includeSubDomains; preload" "$headers"
  assert_header_value "$html_label" "$url" "Cross-Origin-Opener-Policy" "same-origin" "$headers"
  assert_header_value "$html_label" "$url" "Cross-Origin-Resource-Policy" "same-origin" "$headers"
  assert_header_value "$html_label" "$url" "Origin-Agent-Cluster" "?1" "$headers"
  # Substring CSP checks.
  assert_csp_directive "$html_label" "$url" "default-src 'self'" "$headers"
  assert_csp_directive "$html_label" "$url" "frame-ancestors 'none'" "$headers"
  assert_csp_directive "$html_label" "$url" "object-src 'none'" "$headers"
  assert_csp_directive "$html_label" "$url" "https://*.b-cdn.net" "$headers"
  assert_csp_directive "$html_label" "$url" "https://*.supabase.co" "$headers"
  assert_csp_directive "$html_label" "$url" "https://api.stripe.com" "$headers"
done

# 2) Image variant — /og.
img_label="image(/og)"
img_url="$BASE_URL/og?title=Test"
assert_header_present "$img_label" "$img_url" "Strict-Transport-Security" "$HEADERS_OG"
assert_header_present "$img_label" "$img_url" "X-Frame-Options" "$HEADERS_OG"
assert_header_absent "$img_label" "$img_url" "Content-Security-Policy" "$HEADERS_OG"
assert_header_absent "$img_label" "$img_url" "Permissions-Policy" "$HEADERS_OG"
assert_header_absent "$img_label" "$img_url" "Cross-Origin-Opener-Policy" "$HEADERS_OG"
assert_header_absent "$img_label" "$img_url" "Cross-Origin-Resource-Policy" "$HEADERS_OG"

# 3) XML variant — sitemaps.
xml_label="xml(/sitemap.xml)"
assert_header_present "$xml_label" "$BASE_URL/sitemap.xml" "Strict-Transport-Security" "$HEADERS_SITEMAP"
assert_header_present "$xml_label" "$BASE_URL/sitemap.xml" "X-Frame-Options" "$HEADERS_SITEMAP"
assert_header_absent "$xml_label" "$BASE_URL/sitemap.xml" "Content-Security-Policy" "$HEADERS_SITEMAP"
assert_header_absent "$xml_label" "$BASE_URL/sitemap.xml" "Permissions-Policy" "$HEADERS_SITEMAP"

# 4) Text variant — robots.txt.
txt_label="text(/robots.txt)"
assert_header_present "$txt_label" "$BASE_URL/robots.txt" "Strict-Transport-Security" "$HEADERS_ROBOTS"
assert_header_present "$txt_label" "$BASE_URL/robots.txt" "X-Frame-Options" "$HEADERS_ROBOTS"
assert_header_absent "$txt_label" "$BASE_URL/robots.txt" "Content-Security-Policy" "$HEADERS_ROBOTS"
assert_header_absent "$txt_label" "$BASE_URL/robots.txt" "Permissions-Policy" "$HEADERS_ROBOTS"

# 5) JSON variant — /api/search.
json_label="json(/api/search)"
search_url="$BASE_URL/api/search?q=test"
assert_header_present "$json_label" "$search_url" "Strict-Transport-Security" "$HEADERS_SEARCH"
assert_header_present "$json_label" "$search_url" "X-Frame-Options" "$HEADERS_SEARCH"
assert_header_absent "$json_label" "$search_url" "Content-Security-Policy" "$HEADERS_SEARCH"
assert_header_absent "$json_label" "$search_url" "Permissions-Policy" "$HEADERS_SEARCH"

# 6) Binary variant — /api/files/[id]/download.
binary_label="binary(/api/files/1/download)"
download_url="$BASE_URL/api/files/1/download"
assert_header_present "$binary_label" "$download_url" "X-Content-Type-Options" "$HEADERS_DOWNLOAD"
assert_header_absent "$binary_label" "$download_url" "Content-Security-Policy" "$HEADERS_DOWNLOAD"
assert_header_absent "$binary_label" "$download_url" "Strict-Transport-Security" "$HEADERS_DOWNLOAD"
assert_header_absent "$binary_label" "$download_url" "X-Frame-Options" "$HEADERS_DOWNLOAD"
assert_header_absent "$binary_label" "$download_url" "Permissions-Policy" "$HEADERS_DOWNLOAD"

# 7) Webhook variant — /api/webhooks/stripe.
webhook_label="webhook(/api/webhooks/stripe)"
webhook_url="$BASE_URL/api/webhooks/stripe"
assert_header_present "$webhook_label" "$webhook_url" "X-Content-Type-Options" "$HEADERS_WEBHOOK"
assert_header_absent "$webhook_label" "$webhook_url" "Content-Security-Policy" "$HEADERS_WEBHOOK"
assert_header_absent "$webhook_label" "$webhook_url" "Strict-Transport-Security" "$HEADERS_WEBHOOK"
assert_header_absent "$webhook_label" "$webhook_url" "X-Frame-Options" "$HEADERS_WEBHOOK"
assert_header_absent "$webhook_label" "$webhook_url" "Permissions-Policy" "$HEADERS_WEBHOOK"

# 8) Health variant — /healthz + /api/health. These are NOT matched
#    by middleware (the matcher excludes them). The assertion here is
#    that Next.js doesn't crash on them; the header set is the
#    framework default (no security middleware pass).
health_label="health(/healthz, /api/health)"
for url in "$BASE_URL/healthz" "$BASE_URL/api/health"; do
  case "$url" in
    *healthz) headers="$HEADERS_HEALTHZ" ;;
    *api/health) headers="$HEADERS_API_HEALTH" ;;
  esac
  # Just check the route returns 2xx — no specific header assertion
  # since middleware skips these.
  status="$(curl -s -o /dev/null -w '%{http_code}' "$url" 2>/dev/null || echo "000")"
  case "$status" in
    2*|3*)
      echo "  [ok] ${health_label}  ${url}  responds with HTTP ${status}"
      ;;
    *)
      echo "  [FAIL] ${health_label}  ${url}  unexpected HTTP ${status}"
      fail_count=$((fail_count + 1))
      ;;
  esac
done

# 9) X-Powered-By is unset everywhere we can check.
for url in "$BASE_URL/" "$BASE_URL/api/health" "$BASE_URL/api/files/1/download"; do
  case "$url" in
    */) headers="$HEADERS_ROOT" ;;
    */api/health) headers="$HEADERS_API_HEALTH" ;;
    */api/files/1/download) headers="$HEADERS_DOWNLOAD" ;;
  esac
  if printf '%s' "$headers" | grep -qiE '^x-powered-by:'; then
    echo "  [FAIL] ${url}  unexpectedly has X-Powered-By"
    fail_count=$((fail_count + 1))
  else
    echo "  [ok] ${url}  X-Powered-By correctly unset"
  fi
done

if [ "$fail_count" -gt 0 ]; then
  echo
  echo "[check-security-headers] ${fail_count} header assertion(s) failed."
  exit 1
fi

echo "[check-security-headers] All header assertions passed."