// getAffiliateLinkAnalytics.ts — P13.7 link analytics deep data.
//
// Reads three SECURITY DEFINER RPCs from migration 0049 to surface the
// link analytics view the /affiliate/links page renders:
//
//   - get_affiliate_link_hourly_clicks(affiliate_id, hours_back)
//     → 24 hourly buckets (clicks per hour, UTC).
//   - get_affiliate_link_geo_breakdown(affiliate_id, days_back)
//     → top countries + click counts + share_pct.
//   - get_affiliate_link_device_breakdown(affiliate_id, days_back)
//     → device_class breakdown + share_pct.
//
// **Fail-soft contract** (matches getAffiliateDailyPerformance +
// getMyAffiliateLinks): anon → empty array, non-affiliate → empty
// array, RPC error → empty array + warn log with hashed
// affiliate_id. The page renders the empty-state for each section
// independently.
//
// **PII safety**: log payloads use the FNV-1a hashed affiliate_id (no
// raw affiliate_id, no email, no user_id). All three RPCs are
// SECURITY DEFINER + auth-checked; callers only receive rows for
// their own affiliate (or admins get the rows they ask for).
//
// **Bigint / numeric safety**: PostgREST serializes bigint + numeric
// columns as JSON strings (or numbers in the numeric case). The
// helpers below coerce them back to finite numbers with defensive
// fallbacks.

import 'server-only'
import { getServerSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'

const ANALYTICS_LOG = loggerFor({ component: 'affiliate.link_analytics' })

/** One hour bucket in the per-hour clicks series. */
export type AffiliateHourlyClicksPoint = {
  /** Bucket start as ISO 8601 timestamptz (UTC, truncated to the
   *  hour). The page component derives the hour-of-day label from
   *  this value. */
  bucketStart: string
  /** Clicks on the affiliate's links in this hour bucket. */
  clicksCount: number
}

/** One row in the geo breakdown. */
export type AffiliateGeoBreakdownRow = {
  /** ISO 3166-1 alpha-2 country code (e.g. 'US'), or the literal
   *  'Unknown' for the NULL bucket. The page renders the unknown
   *  bucket with a help caption explaining the enrichment pipeline
   *  is deferred (STUB-105 Slice 7 — /api/affiliate/click). */
  country: string
  /** Click count in the window. */
  clicksCount: number
  /** Share of total clicks in the window, 0..100. NULL when the
   *  window is empty. */
  sharePct: number | null
}

/** One row in the device breakdown. */
export type AffiliateDeviceBreakdownRow = {
  /** Device class ('mobile' | 'desktop' | 'tablet' | 'bot') or the
   *  literal 'Unknown' for the NULL bucket. The page renders known
   *  classes with a label + the Unknown bucket with the help
   *  caption. */
  deviceClass: string
  /** Click count in the window. */
  clicksCount: number
  /** Share of total clicks in the window, 0..100. NULL when the
   *  window is empty. */
  sharePct: number | null
}

/** Coerce a PostgREST bigint-as-string value back to a finite
 *  non-negative number. Returns 0 for null / NaN / non-numeric /
 *  negative values. */
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

/** Coerce a numeric share (PostgREST may return as string or
 *  number) to a finite 0..100 number, 2 decimals. Returns null
 *  for null / NaN / out-of-range values (the RPC returns NULL when
 *  the window is empty). */
function coerceShare(v: unknown): number | null {
  if (v == null) return null
  const n =
    typeof v === 'number'
      ? v
      : typeof v === 'string'
        ? Number.parseFloat(v)
        : NaN
  if (!Number.isFinite(n)) return null
  // The RPC returns 0..100 with 2 decimals; clamp defensively.
  return Math.max(0, Math.min(100, n))
}

/** Coerce a timestamptz / ISO string into a canonical ISO 8601
 *  string. Returns the empty string for malformed values (the page
 *  treats empty as "skip" / fall back to the bucket index). */
function coerceIso(v: unknown): string {
  if (typeof v !== 'string') return ''
  if (v.length < 10) return ''
  // Cheap sanity check: must look like an ISO timestamp.
  const t = new Date(v)
  if (Number.isNaN(t.getTime())) return ''
  return t.toISOString()
}

/** FNV-1a 32-bit hash for log payloads. Matches the helper in
 *  getAffiliateDailyPerformance.ts + getMyAffiliateLinks.ts —
 *  duplicated here to keep this file standalone and avoid a
 *  circular import. */
function hashAffiliateId(affiliateId: number): string {
  let hash = 0x811c9dc5
  for (const ch of String(affiliateId)) {
    hash ^= ch.charCodeAt(0)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * Read the affiliate's per-hour click series for the last
 * `hoursBack` hours (default 24, hard-clamped by the RPC to
 * [1, 168]).
 *
 * Fail-soft: returns `[]` on anon / non-affiliate / RPC error.
 */
export async function getAffiliateHourlyClicks(
  opts: { hoursBack?: number } = {},
): Promise<AffiliateHourlyClicksPoint[]> {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  const { data: affiliate, error: affErr } = await supabase
    .from('affiliates')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (affErr) {
    ANALYTICS_LOG.warn(
      { code: affErr.code ?? null },
      'affiliates row read failed',
    )
    return []
  }
  if (!affiliate) return []

  const hoursBack = opts.hoursBack ?? 24
  const { data, error } = await supabase.rpc(
    'get_affiliate_link_hourly_clicks',
    {
      p_affiliate_id: (affiliate as { id: unknown }).id as number,
      p_hours_back: hoursBack,
    },
  )
  if (error) {
    ANALYTICS_LOG.warn(
      {
        affiliate_id_hash: hashAffiliateId(
          (affiliate as { id: number }).id,
        ),
        code: error.code ?? null,
      },
      'hourly clicks RPC failed',
    )
    return []
  }
  if (!Array.isArray(data)) return []
  return (data as Array<Record<string, unknown>>).map((row) => ({
    bucketStart: coerceIso(row.bucket_start),
    clicksCount: coerceBigint(row.clicks_count),
  }))
}

/**
 * Read the affiliate's country breakdown for the last `daysBack`
 * days (default 30, hard-clamped by the RPC to [1, 365]).
 *
 * Fail-soft: returns `[]` on anon / non-affiliate / RPC error.
 */
export async function getAffiliateGeoBreakdown(
  opts: { daysBack?: number } = {},
): Promise<AffiliateGeoBreakdownRow[]> {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  const { data: affiliate, error: affErr } = await supabase
    .from('affiliates')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (affErr) {
    ANALYTICS_LOG.warn(
      { code: affErr.code ?? null },
      'affiliates row read failed (geo)',
    )
    return []
  }
  if (!affiliate) return []

  const daysBack = opts.daysBack ?? 30
  const { data, error } = await supabase.rpc(
    'get_affiliate_link_geo_breakdown',
    {
      p_affiliate_id: (affiliate as { id: unknown }).id as number,
      p_days_back: daysBack,
    },
  )
  if (error) {
    ANALYTICS_LOG.warn(
      {
        affiliate_id_hash: hashAffiliateId(
          (affiliate as { id: number }).id,
        ),
        code: error.code ?? null,
      },
      'geo breakdown RPC failed',
    )
    return []
  }
  if (!Array.isArray(data)) return []
  return (data as Array<Record<string, unknown>>).map((row) => ({
    country:
      typeof row.country === 'string' && row.country.length > 0
        ? row.country
        : 'Unknown',
    clicksCount: coerceBigint(row.clicks_count),
    sharePct: coerceShare(row.share_pct),
  }))
}

/**
 * Read the affiliate's device_class breakdown for the last
 * `daysBack` days (default 30, hard-clamped by the RPC to
 * [1, 365]).
 *
 * Fail-soft: returns `[]` on anon / non-affiliate / RPC error.
 */
export async function getAffiliateDeviceBreakdown(
  opts: { daysBack?: number } = {},
): Promise<AffiliateDeviceBreakdownRow[]> {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  const { data: affiliate, error: affErr } = await supabase
    .from('affiliates')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (affErr) {
    ANALYTICS_LOG.warn(
      { code: affErr.code ?? null },
      'affiliates row read failed (device)',
    )
    return []
  }
  if (!affiliate) return []

  const daysBack = opts.daysBack ?? 30
  const { data, error } = await supabase.rpc(
    'get_affiliate_link_device_breakdown',
    {
      p_affiliate_id: (affiliate as { id: unknown }).id as number,
      p_days_back: daysBack,
    },
  )
  if (error) {
    ANALYTICS_LOG.warn(
      {
        affiliate_id_hash: hashAffiliateId(
          (affiliate as { id: number }).id,
        ),
        code: error.code ?? null,
      },
      'device breakdown RPC failed',
    )
    return []
  }
  if (!Array.isArray(data)) return []
  return (data as Array<Record<string, unknown>>).map((row) => ({
    deviceClass:
      typeof row.device_class === 'string' && row.device_class.length > 0
        ? row.device_class
        : 'Unknown',
    clicksCount: coerceBigint(row.clicks_count),
    sharePct: coerceShare(row.share_pct),
  }))
}