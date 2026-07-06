// getPartnerDashboardExtras.ts — P12.4 dashboard refinements.
//
// Two RSC-side data helpers for the /partner dashboard sections
// that aren't covered by the headline `getPartnerDashboardSummary`:
//   - getPartnerRecentActivity()  → "Recent activity" feed (last 10
//     events: sales / refunds / payouts) — read from RPC
//     get_partner_recent_activity (migration 0038).
//   - getPartnerDailySalesSeries()  → "Earnings" chart data
//     (N daily buckets back from today) — read from RPC
//     get_partner_daily_sales_series (migration 0038).
//
// Both helpers mirror the P6.1 / P6.2 fail-soft contract: if the
// RPC fails, log a warn with a hashed partner_id (no PII) and
// return the empty default. The dashboard must never error out
// because the chart data is transient.

import 'server-only'
import { getServerSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'

/** Shape of a single feed entry. The RPC declares each column
 *  typed but PostgREST may return bigint as a JSON string on
 *  the wire, so the consumer narrows with the `coerceBigint`
 *  helper below. */
export type PartnerActivityKind =
  | 'sale'
  | 'refund'
  | 'payout'
  | 'clawback'
  | 'adjustment'
  | 'subscription'

export type PartnerActivityEntry = {
  /** ISO-8601 timestamp (server-rendered date). */
  eventAt: string
  /** Discriminator for the feed icon + label. Normalized from the
   *  RPC's `event_kind` to one of the kinds above — the RPC's
   *  SQL `kind::text` cast yields `order_sale` / `refund` etc.
   *  in snake_case; we map to the consumer-facing camelCase form. */
  kind: PartnerActivityKind
  /** Human-readable description (e.g. "New sale", "Refund").
   *  Built server-side via SQL CASE; the page renders this verbatim. */
  description: string
  /** Signed cents (positive = credit, negative = debit for
   *  refunds/clawbacks). Display-only; the page formats USD. */
  amountCents: number
  /** Product title for order-tied entries (sales, refunds). Null
   *  for payout / clawback / adjustment rows that aren't tied to
   *  a specific product line. */
  productTitle: string | null
  /** Order ID for order-tied entries; null otherwise. The page
   *  uses this for the "View order" deep link affordance — no
   *  PII because it's an internal bigint. */
  orderId: number | null
}

/** Shape of one bar in the earnings chart. The RPC always returns
 *  `days` rows (filled with zeros for empty days). The page passes
 *  the array straight into the SVG renderer. */
export type PartnerSalesSeriesPoint = {
  /** UTC date as ISO `YYYY-MM-DD`. The chart's X axis label is
   *  derived from this string in the partner's timezone. */
  day: string
  /** Gross order sales in cents for the day. */
  salesCents: number
  /** Number of distinct orders for the day. The chart can show
   *  this count below each bar as a tertiary detail if it wants. */
  orderCount: number
}

const DASHBOARD_EXTRAS_LOG = loggerFor({ component: 'partner.dashboard.extras' })

/** Coerce a PostgREST bigint-as-string value back to a finite number.
 *  Used for: amount_cents, order_id. Returns 0 for null / NaN / non-
 *  numeric values. */
function coerceBigint(v: unknown): number {
  if (v == null) return 0
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (typeof v === 'string') {
    const n = Number.parseInt(v, 10)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

function coerceInt(v: unknown): number {
  return coerceBigint(v)
}

/** Map the RPC's snake_case event_kind to the consumer-facing
 *  PartnerActivityKind. Unknown values fall through to 'sale'
 *  (the most common kind) so an enum-extension in the migration
 *  doesn't crash the page. Defense-in-depth — the SQL CASE in the
 *  RPC already covers the known enum values, this is the JS backstop. */
function normalizeEventKind(raw: unknown): PartnerActivityKind {
  const v = typeof raw === 'string' ? raw : ''
  switch (v) {
    case 'order_sale':
      return 'sale'
    case 'refund':
      return 'refund'
    case 'payout':
      return 'payout'
    case 'clawback':
      return 'clawback'
    case 'adjustment':
      return 'adjustment'
    case 'subscription':
      return 'subscription'
    default:
      return 'sale'
  }
}

/** Date string guard — the RPC declares `day date` so PostgREST
 *  typically serializes as `YYYY-MM-DD`. Supabase + PostgREST's
 *  date wire format can vary by version:
 *   - `2026-06-01` — bare date (most common form)
 *   - `2026-06-01T00:00:00+00:00` — full ISO with timezone offset
 *   - `2026-06-01T00:00:00.000Z` — full ISO in UTC
 *   - `2026-06-01T00:00:00Z` — full ISO in UTC shorthand
 *  All of these start with the `YYYY-MM-DD` 10-char prefix; we
 *  accept the prefix and drop the rest. */
function coerceDayString(v: unknown): string {
  if (typeof v !== 'string' || v.length < 10) return ''
  // Detect ISO-8601 date-like prefix: `YYYY-MM-DD` (digits + dashes).
  // Cheap regex check before slicing — avoids accidental matches on
  // strings like "12345abcde" which happen to have 10+ chars.
  if (!/^\d{4}-\d{2}-\d{2}/.test(v)) return ''
  return v.slice(0, 10)
}

/** Build a stable hash for the partner_id in logs. No PII — just
 *  enough to correlate a log line with a subsequent one. FNV-1a
 *  matches the helper in getMyPartnerProfile.ts. Duplicated here
 *  (instead of shared) to keep this file standalone and avoid a
 *  circular import. */
function hashPartnerId(partnerId: number): string {
  let hash = 0x811c9dc5
  for (const ch of String(partnerId)) {
    hash ^= ch.charCodeAt(0)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * Read the most recent activity-feed entries for the partner.
 *
 * Reads from RPC `get_partner_recent_activity(partner_id, limit)`
 * (migration 0038, P12.4). The RPC is SECURITY DEFINER + checks
 * `current_partner_id() = p_partner_id or is_admin()` internally,
 * so unauthorized callers receive zero rows.
 *
 * Fail-soft: returns [] on RPC error or for non-partner users.
 *
 * @param opts.limit  Maximum entries to return. Hard-capped at the
 *                    RPC level to 50; defaults to 10.
 * @returns           Array of feed entries, newest first.
 */
export async function getPartnerRecentActivity(
  opts: { limit?: number } = {},
): Promise<PartnerActivityEntry[]> {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  // Look up the partner row key by user_id. Same shape as the inline
  // lookup in getMyPartnerProducts.ts; duplicated here to keep this
  // file standalone and avoid a circular import.
  const { data: partner } = await supabase
    .from('partners')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!partner) return []

  const limit = opts.limit ?? 10
  const { data, error } = await supabase.rpc('get_partner_recent_activity', {
    p_partner_id: (partner as { id: unknown }).id as number,
    p_limit: limit,
  })

  if (error) {
    DASHBOARD_EXTRAS_LOG.warn(
      { partner_id_hash: hashPartnerId((partner as { id: number }).id), code: error.code ?? null },
      'recent activity RPC failed',
    )
    return []
  }
  if (!Array.isArray(data)) return []

  return (data as Array<Record<string, unknown>>).map((row) => ({
    eventAt: typeof row.event_at === 'string' ? row.event_at : '',
    kind: normalizeEventKind(row.event_kind),
    description: typeof row.description === 'string' ? row.description : '',
    amountCents: coerceBigint(row.amount_cents),
    productTitle: typeof row.product_title === 'string' ? row.product_title : null,
    orderId:
      row.order_id == null
        ? null
        : coerceInt(row.order_id) > 0
          ? coerceInt(row.order_id)
          : null,
  }))
}

/**
 * Read the daily sales series for the partner's earnings chart.
 *
 * Reads from RPC `get_partner_daily_sales_series(partner_id,
 * days_back)` (migration 0038). The RPC is SECURITY DEFINER + auth-
 * checked; it ALWAYS returns exactly N rows (filled with zeros for
 * empty days), so the chart's X axis is guaranteed to render.
 *
 * Fail-soft: returns an empty array on RPC error or for non-partner
 * users. The chart treats empty data as "all zeros" — the page
 * should render the empty-state message instead of a broken chart.
 *
 * @param opts.daysBack  How many days back to read. Hard-capped at
 *                       the RPC level to [7, 365]; defaults to 30
 *                       (matches the spec "last 30 days").
 */
export async function getPartnerDailySalesSeries(
  opts: { daysBack?: number } = {},
): Promise<PartnerSalesSeriesPoint[]> {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  const { data: partner } = await supabase
    .from('partners')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!partner) return []

  const daysBack = opts.daysBack ?? 30
  const { data, error } = await supabase.rpc('get_partner_daily_sales_series', {
    p_partner_id: (partner as { id: unknown }).id as number,
    p_days_back: daysBack,
  })

  if (error) {
    DASHBOARD_EXTRAS_LOG.warn(
      { partner_id_hash: hashPartnerId((partner as { id: number }).id), code: error.code ?? null },
      'daily sales series RPC failed',
    )
    return []
  }
  if (!Array.isArray(data)) return []

  return (data as Array<Record<string, unknown>>).map((row) => ({
    day: coerceDayString(row.day),
    salesCents: coerceBigint(row.sales_cents),
    orderCount: coerceInt(row.order_count),
  }))
}
