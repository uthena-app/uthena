// formatStorageSize.ts — pure formatter that turns a bigint-safe
// byte count into a human-readable storage size string (e.g.
// "1.23 GB", "456 MB", "789 B").
//
// P7.10 — Storage quota display. The pure module lives here
// (separate from the query) so the query surface can ship
// minimal + the formatter can be tested without DB mocks.
//
// Design:
//   - Bytes are stored as `bigint` in Postgres (`product_files.
//     size_bytes`). PostgREST returns bigints as JSON strings
//     (TypeScript can't safely JSON.parse an arbitrary-length
//     integer), so the input accepts `number | string` and is
//     defensive against every malformed shape.
//   - Units are SI decimal (KB = 1000 B, not 1024 B). Storage
//     vendors (Bunny, AWS S3, Cloudflare R2, Stripe, Resend
//     dashboards) all use SI; matching their convention is
//     what users will read in their other tools.
//   - Decimals are capped at 2 places so "1.2 GB" reads cleanly
//     (a partner scanning the admin's per-partner view shouldn't
//     have to count trailing zeros).
//   - Negative or NaN inputs → "0 B" (defensive; the DB has a
//     `size_bytes >= 0` CHECK but bad data could still sneak in
//     via a migration).
//   - Locale defaults to 'en-US' so the comma-thousands separator
//     is consistent with the rest of the app. Callers can
//     override for i18n later (no current need).
//
// Rounding: ROUND-HALF-AWAY-FROM-ZERO via `Math.round(x*100)/100`
// so 1.005 GB → "1.01 GB" (not "1 GB"). No Math.floor because
// that would systematically underreport (1.999 GB → "1.99 GB",
// not "2 GB") and make storage quotas feel stingy.
//
// No client JS shipped. The function is called from RSC
// components and from server queries; the output is a plain
// string.

export type StorageSizeOptions = {
  /** Locale string for the number formatter (default 'en-US').
   *  Currently only the comma-thousands separator varies by
   *  locale; future i18n can extend. */
  locale?: string
  /** Force a minimum unit (e.g. always show MB even if size < 1
   *  MB). Default: pick the largest unit where value ≥ 1. */
  minUnit?: StorageUnit
  /** Maximum decimal places. Default 2. */
  decimals?: number
}

export type StorageUnit = 'B' | 'KB' | 'MB' | 'GB' | 'TB'

const UNIT_STEPS: ReadonlyArray<{ unit: StorageUnit; bytes: number }> = [
  { unit: 'TB', bytes: 1_000_000_000_000 },
  { unit: 'GB', bytes: 1_000_000_000 },
  { unit: 'MB', bytes: 1_000_000 },
  { unit: 'KB', bytes: 1_000 },
  { unit: 'B', bytes: 1 },
]

/**
 * Format a byte count as a human-readable storage size string.
 *
 * Examples:
 *   formatStorageSize(0)                              → "0 B"
 *   formatStorageSize(512)                            → "512 B"
 *   formatStorageSize(1500)                           → "1.5 KB"
 *   formatStorageSize(1_500_000_000)                  → "1.5 GB"
 *   formatStorageSize(1_500_000_000, { decimals: 0 }) → "2 GB"
 *   formatStorageSize(0, { minUnit: 'MB' })           → "0 MB"
 *   formatStorageSize(-1)                             → "0 B" (defensive)
 *   formatStorageSize('not a number')                 → "0 B" (defensive)
 *   formatStorageSize(1_234_567_890, { locale: 'de-DE' }) → "1,23 GB"
 */
export function formatStorageSize(
  bytes: number | string | null | undefined,
  opts: StorageSizeOptions = {},
): string {
  const { locale = 'en-US', minUnit, decimals = 2 } = opts

  const safe = coerceBytes(bytes)
  if (safe === 0) {
    const zeroUnit = pickZeroUnit(minUnit)
    return `0 ${zeroUnit}`
  }

  const startIdx = minUnit ? indexOfUnit(minUnit) : -1
  // Pick the largest unit where the value is >= 1 (unless caller
  // pinned a minimum unit).
  let chosen = UNIT_STEPS[UNIT_STEPS.length - 1]!
  for (let i = 0; i < UNIT_STEPS.length; i++) {
    const candidate = UNIT_STEPS[i]!
    if (safe >= candidate.bytes) {
      chosen = candidate
      break
    }
  }
  // If the caller pinned a minimum unit LARGER than what we'd
  // naturally pick, use the pinned unit instead. A pinned unit
  // SMALLER than the natural pick is ignored — the natural pick
  // already satisfies the "at least minUnit" constraint.
  if (startIdx !== -1) {
    const pinned = UNIT_STEPS[startIdx]!
    if (pinned.bytes > chosen.bytes) chosen = pinned
  }

  const value = safe / chosen.bytes
  const formatted = formatNumber(value, locale, decimals)
  return `${formatted} ${chosen.unit}`
}

/**
 * Parse the PostgREST bigint-as-string payload defensively. Returns
 * a number for finite, non-negative values; returns 0 for anything
 * malformed or negative.
 *
 * Why not `BigInt`: every consumer wants a `number` for arithmetic
 * + rendering. The Postgres `bigint` column is bounded at ~9.2 EB,
 * well beyond `Number.MAX_SAFE_INTEGER` (8 PB) but the realistic
 * per-partner totals are < 1 PB for many years (Bunny's hard
 * per-video cap is GB-scale). We accept the precision loss for
 * totals above 8 PB and document it in the query layer.
 */
function coerceBytes(bytes: number | string | null | undefined): number {
  if (bytes === null || bytes === undefined) return 0
  const n = typeof bytes === 'string' ? Number(bytes) : bytes
  if (typeof n !== 'number' || !Number.isFinite(n)) return 0
  if (n < 0) return 0
  // Cap at Number.MAX_SAFE_INTEGER to keep arithmetic safe.
  if (n > Number.MAX_SAFE_INTEGER) return Number.MAX_SAFE_INTEGER
  return n
}

function pickZeroUnit(minUnit: StorageUnit | undefined): StorageUnit {
  if (minUnit) return minUnit
  return 'B'
}

function indexOfUnit(unit: StorageUnit): number {
  for (let i = 0; i < UNIT_STEPS.length; i++) {
    if (UNIT_STEPS[i]!.unit === unit) return i
  }
  return -1
}

function formatNumber(value: number, locale: string, decimals: number): string {
  // Clamp decimals to a sane range so a buggy caller can't render
  // 1.5000000000000002 GB or 1 GB with 50 trailing zeros.
  const d = Math.max(0, Math.min(decimals, 4))
  // Round half away from zero. We use a small positive nudge
  // (sign * EPSILON * 1e3) to dodge the classic floating-point
  // trap where 1.005 * 100 = 100.499999... and Math.round
  // collapses to 100 instead of 101. The nudge is too small
  // (2.22e-13) to flip a non-.5 case (1.234567 stays at 123).
  const nudge = Math.sign(value) * Number.EPSILON * 1e3
  const rounded = Math.round(value * 10 ** d + nudge) / 10 ** d
  // minimumFractionDigits=0 + maximumFractionDigits=d gives us
  // "1.5" instead of "1.50" (trailing zeros stripped) for the
  // common case where rounding collapses a decimal place.
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: d,
  }).format(rounded)
}