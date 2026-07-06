// getAffiliateDailyPerformance.ts — P13.4 dashboard chart data.
//
// Reads the daily time series the P13.4 dashboard renders: clicks +
// conversions + revenue over time. Wraps the
// `get_affiliate_daily_performance(p_affiliate_id, p_days_back)` RPC
// from migration 0047.
//
// **Fail-soft contract** (matches getPartnerDashboardExtras): on any
// read error or anon user, returns an empty array. The chart treats
// empty data as "render the empty-state card" — the page must
// continue to load.
//
// **PII safety**: log payloads use the FNV-1a hashed affiliate_id (no
// raw affiliate_id, no email, no user_id). The RPC itself is
// SECURITY DEFINER + auth-gated; callers only receive rows for
// their own affiliate (or admins get the rows they ask for).
//
// **Bigint safety**: PostgREST serializes bigint columns as JSON
// strings; the helpers below coerce them back to finite numbers with
// defensive fallbacks (matching the getAffiliateDashboard + P12.4
// EarningsChart patterns).

import 'server-only'
import { getServerSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'

const PERFORMANCE_LOG = loggerFor({ component: 'affiliate.performance' })

/** Shape of one bar/point in the daily series. Always one entry per
 *  day in the window — even empty days render as {clicks: 0,
 *  conversions: 0, revenue: 0}. The chart always renders a complete
 *  X axis. */
export type AffiliateDailyPerformancePoint = {
  /** UTC date as ISO `YYYY-MM-DD`. The chart's X axis label is derived
   *  from this string. */
  day: string
  /** Clicks on this affiliate's links that day. */
  clicksCount: number
  /** Commission rows created that day (excludes `status='reversed'` —
   *  matches the dashboard KPI denominator). */
  conversionsCount: number
  /** Sum of commission_cents that day (excludes `status='reversed'`).
   *  USD cents — multiply by 0.01 to format. */
  revenueCents: number
}

/** Coerce a PostgREST bigint-as-string value back to a finite
 *  non-negative number. Returns 0 for null / NaN / non-numeric
 *  / negative values. */
function coerceBigint(v: unknown): number {
  if (v == null) return 0
  if (typeof v === 'number') {
    return Number.isFinite(v) ? Math.max(0, Math.trunc(v)) : 0
  }
  if (typeof v === 'string') {
    const n = Number.parseInt(v, 10)
    return Number.isFinite(n) ? Math.max(0, n) : 0
  }
  return 0
}

/** Coerce a Date / ISO string into a bare `YYYY-MM-DD` string. The
 *  RPC may return either a bare date or a full ISO depending on
 *  PostgREST version — same defensive pattern as
 *  getPartnerDashboardExtras.coerceDayString. */
function coerceDayString(v: unknown): string {
  if (typeof v !== 'string' || v.length < 10) return ''
  // Cheap prefix check: `YYYY-MM-DD` only.
  if (!/^\d{4}-\d{2}-\d{2}/.test(v)) return ''
  return v.slice(0, 10)
}

/** FNV-1a 32-bit hash for log payloads. Matches the helper in
 *  getAffiliateDashboard.ts — duplicated here to keep this file
 *  standalone and avoid a circular import (both files are loaded by
 *  the same page route but neither one re-exports the other's
 *  hashing helper). */
function hashAffiliateId(affiliateId: number): string {
  let hash = 0x811c9dc5
  for (const ch of String(affiliateId)) {
    hash ^= ch.charCodeAt(0)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * Read the affiliate's daily time series (clicks + conversions +
 * revenue) for the last `daysBack` days.
 *
 * Reads from RPC `get_affiliate_daily_performance(p_affiliate_id,
 * p_days_back)` (migration 0047). The RPC is SECURITY DEFINER +
 * auth-checked; it ALWAYS returns exactly N rows (filled with zeros
 * for empty days), so the chart's X axis is guaranteed to render at
 * any data sparsity.
 *
 * Fail-soft: returns `[]` on anon / non-affiliate / RPC error.
 *
 * @param opts.daysBack  How many days back to read. Defaults to 30
 *                       (matches the spec "last 30 days"). The RPC
 *                       hard-clamps to [7, 365] — values outside the
 *                       range still produce a valid (possibly clipped)
 *                       response, never an error.
 */
export async function getAffiliateDailyPerformance(
  opts: { daysBack?: number } = {},
): Promise<AffiliateDailyPerformancePoint[]> {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  // Round 1 (sequential; cheap): resolve the affiliate row key by
  // user_id. The RPC needs the affiliate_id; the page's
  // getAffiliateDashboard also reads the same row, but Promise.all-ing
  // them requires the affiliate id up front. Two cheap reads (the
  // index covers both) instead of a restructure.
  const { data: affiliate } = await supabase
    .from('affiliates')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!affiliate) return []

  const daysBack = opts.daysBack ?? 30

  const { data, error } = await supabase.rpc(
    'get_affiliate_daily_performance',
    {
      p_affiliate_id: (affiliate as { id: unknown }).id as number,
      p_days_back: daysBack,
    },
  )

  if (error) {
    PERFORMANCE_LOG.warn(
      {
        affiliate_id_hash: hashAffiliateId(
          (affiliate as { id: number }).id,
        ),
        code: error.code ?? null,
      },
      'daily performance RPC failed',
    )
    return []
  }
  if (!Array.isArray(data)) return []

  return (data as Array<Record<string, unknown>>).map((row) => ({
    day: coerceDayString(row.day),
    clicksCount: coerceBigint(row.clicks_count),
    conversionsCount: coerceBigint(row.conversions_count),
    revenueCents: coerceBigint(row.revenue_cents),
  }))
}
