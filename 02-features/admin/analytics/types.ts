// Types for the Admin Analytics dashboard (P14.16).
//
// Slice 1 ships the schema foundation + the 6-KPI read surface.
// Charts, top-10 lists, funnel, cohort grid, and CSV exports land
// in Slices 2-5 (filed as STUB-127).
//
// Money is bigint cents — never decimals per AGENTS.md. Counts are
// int. Dates are ISO YYYY-MM-DD strings (Postgres `date` type).

import { z } from 'zod'

// ---------------------------------------------------------------------------
// Date-range URL contract.
// ---------------------------------------------------------------------------

/** Date-range presets the admin can pick from the range picker. */
export const ANALYTICS_RANGE_PRESETS = ['30d', '60d', '90d', '365d'] as const
export type AnalyticsRangePreset = (typeof ANALYTICS_RANGE_PRESETS)[number]

/** Default range per spec §Acceptance criteria ("Date range defaults to last 30d"). */
export const DEFAULT_ANALYTICS_RANGE_PRESET: AnalyticsRangePreset = '30d'

/** Maximum allowed range per spec ("max range is 365d"). */
export const MAX_ANALYTICS_RANGE_DAYS = 365

/** Map a preset to its day count. Pure — no clock dependency. */
export const ANALYTICS_RANGE_DAYS: Record<AnalyticsRangePreset, number> = {
  '30d': 30,
  '60d': 60,
  '90d': 90,
  '365d': 365,
}

/** YYYY-MM-DD regex. Same shape used by other admin pages (customers, refunds, ...). */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** True iff `s` is a real calendar date (catches 2026-02-30 + 2026-13-01). */
function isValidIsoDate(s: string): boolean {
  if (!ISO_DATE_RE.test(s)) return false
  const [y, m, d] = s.split('-').map((n) => Number.parseInt(n, 10))
  if (!y || !m || !d) return false
  if (m < 1 || m > 12) return false
  if (d < 1 || d > 31) return false
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

/** URL-input Zod schema. Accepts the 4 presets or two YYYY-MM-DD strings. */
export const AnalyticsRangeInputSchema = z
  .object({
    preset: z.enum(ANALYTICS_RANGE_PRESETS).optional(),
    from: z.string().optional(),
    to: z.string().optional(),
  })
  .strict()

export type AnalyticsRangeInput = z.infer<typeof AnalyticsRangeInputSchema>

/** Parsed analytics range — exactly one of `preset` or `from`+`to` will be set. */
export type AnalyticsRange =
  | { kind: 'preset'; preset: AnalyticsRangePreset; fromIso: string; toIso: string; days: number }
  | { kind: 'custom'; fromIso: string; toIso: string; days: number }

export const EMPTY_ANALYTICS_RANGE: AnalyticsRange = {
  kind: 'preset',
  preset: DEFAULT_ANALYTICS_RANGE_PRESET,
  fromIso: '',
  toIso: '',
  days: ANALYTICS_RANGE_DAYS[DEFAULT_ANALYTICS_RANGE_PRESET],
}

/**
 * Pure URL-param → AnalyticsRange parser.
 *
 * Rules (per spec):
 *   - `preset` wins over `from`/`to` when present and valid.
 *   - `from`/`to` custom range: both required, both valid ISO dates,
 *     `from <= to`, range span <= 365 days.
 *   - Anything malformed → default 30d preset (fail-soft — the page
 *     always renders; bad input never 500s).
 *   - The `now` parameter is injectable for tests; defaults to Date.now().
 */
export function parseAnalyticsRange(
  input: unknown,
  now: number = Date.now(),
): AnalyticsRange {
  const parsed = AnalyticsRangeInputSchema.safeParse(input)
  if (!parsed.success) return rangeForPreset(DEFAULT_ANALYTICS_RANGE_PRESET, now)

  // Preset path.
  if (parsed.data.preset) {
    return rangeForPreset(parsed.data.preset, now)
  }

  // Custom path: both from + to required, valid, ordered, bounded.
  const { from, to } = parsed.data
  if (!from || !to) return rangeForPreset(DEFAULT_ANALYTICS_RANGE_PRESET, now)
  if (!isValidIsoDate(from) || !isValidIsoDate(to)) {
    return rangeForPreset(DEFAULT_ANALYTICS_RANGE_PRESET, now)
  }
  const fromMs = Date.parse(`${from}T00:00:00Z`)
  const toMs = Date.parse(`${to}T00:00:00Z`)
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
    return rangeForPreset(DEFAULT_ANALYTICS_RANGE_PRESET, now)
  }
  if (fromMs > toMs) return rangeForPreset(DEFAULT_ANALYTICS_RANGE_PRESET, now)
  const days = Math.floor((toMs - fromMs) / 86_400_000) + 1
  if (days > MAX_ANALYTICS_RANGE_DAYS) {
    return rangeForPreset(DEFAULT_ANALYTICS_RANGE_PRESET, now)
  }
  return { kind: 'custom', fromIso: from, toIso: to, days }
}

function rangeForPreset(preset: AnalyticsRangePreset, now: number): AnalyticsRange {
  const days = ANALYTICS_RANGE_DAYS[preset]
  const toMs = now
  const fromMs = toMs - (days - 1) * 86_400_000
  return {
    kind: 'preset',
    preset,
    fromIso: toIsoDate(fromMs),
    toIso: toIsoDate(toMs),
    days,
  }
}

function toIsoDate(ms: number): string {
  const d = new Date(ms)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// ---------------------------------------------------------------------------
// KPI shape (the 6 stat cards per spec §Data).
// ---------------------------------------------------------------------------

/**
 * The 6 KPIs the page renders per spec line 16.
 *   - `totalRevenueCents` — gross revenue (period)
 *   - `totalOrders`       — order count (period)
 *   - `newSignups`        — signup count (period)
 *   - `conversionRatePct` — visitor→purchase (0..100, 0 when no visitors)
 *   - `refundRatePct`     — refund count / order count × 100 (0..100)
 *   - `chargebackRatePct` — chargeback count / order count × 100 (0..100)
 *
 * All values are precomputed server-side from the `analytics_daily`
 * aggregate. The page never aggregates raw `orders`.
 */
export type AnalyticsKpi = {
  totalRevenueCents: number
  totalOrders: number
  newSignups: number
  conversionRatePct: number
  refundRatePct: number
  chargebackRatePct: number
}

export const EMPTY_ANALYTICS_KPI: AnalyticsKpi = {
  totalRevenueCents: 0,
  totalOrders: 0,
  newSignups: 0,
  conversionRatePct: 0,
  refundRatePct: 0,
  chargebackRatePct: 0,
}

/** The 6 KPI card descriptors (label + key). UI rendering uses these. */
export type AnalyticsKpiCard = {
  key: keyof AnalyticsKpi
  label: string
  /** True iff this KPI needs a "%" suffix in the rendered card. */
  isPercent: boolean
}

export const ANALYTICS_KPI_CARDS: readonly AnalyticsKpiCard[] = [
  { key: 'totalRevenueCents', label: 'Revenue', isPercent: false },
  { key: 'totalOrders', label: 'Orders', isPercent: false },
  { key: 'newSignups', label: 'New signups', isPercent: false },
  { key: 'conversionRatePct', label: 'Conversion', isPercent: true },
  { key: 'refundRatePct', label: 'Refund rate', isPercent: true },
  { key: 'chargebackRatePct', label: 'Chargeback rate', isPercent: true },
] as const