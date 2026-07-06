// getAnalyticsKpi.ts — reads the 6 KPIs from analytics_daily for the
// given date range. Fails soft to EMPTY_ANALYTICS_KPI on any DB error
// so the page always renders.
//
// Slice 1 reads the 'all' dimension_kind rows directly. Slice 2
// (STUB-127) will introduce a SECURITY DEFINER RPC for the aggregate
// so we don't fan out client-side.
//
// Auth-gated to admin / super_admin at the application layer (the
// table's RLS policy also enforces). Returns the parsed KPI shape
// or EMPTY_ANALYTICS_KPI on error / empty result.

import 'server-only'
import { requireRole } from '@foundations/auth/guards'
import { getServerSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'
import {
  EMPTY_ANALYTICS_KPI,
  type AnalyticsKpi,
  type AnalyticsRange,
} from '../types'

const log = loggerFor({ component: 'admin.analytics.getAnalyticsKpi' })

type DailyRow = {
  date: string
  revenue_cents: number | string | null
  order_count: number | string | null
  refund_count: number | string | null
  chargeback_count: number | string | null
  signup_count: number | string | null
  visitor_count: number | string | null
}

/**
 * Defensive coercion: PostgREST bigint-as-string + null + negative
 * handling. Always returns a non-negative integer.
 */
function coerceCount(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0
  const parsed = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, Math.floor(parsed))
}

/**
 * Defensive bigint-as-string coercion for money columns. Same shape
 * as coerceCount but kept separate for clarity (revenue vs counts).
 */
function coerceCents(v: number | string | null | undefined): number {
  return coerceCount(v)
}

/**
 * Fetch the 6 KPIs for the given date range. Fails soft on any
 * error → EMPTY_ANALYTICS_KPI.
 *
 * @param range - parsed AnalyticsRange (preset or custom)
 */
export async function getAnalyticsKpi(range: AnalyticsRange): Promise<AnalyticsKpi> {
  await requireRole(['admin', 'super_admin'])
  const supabase = await getServerSupabase()

  // Query the 'all' dimension rows in the date range. The page never
  // queries raw `orders` — it reads only the pre-aggregated
  // `analytics_daily` table.
  const { data, error } = await supabase
    .from('analytics_daily')
    .select(
      'date, revenue_cents, order_count, refund_count, chargeback_count, signup_count, visitor_count',
    )
    .eq('dimension_kind', 'all')
    .is('dimension_id', null)
    .gte('date', range.fromIso)
    .lte('date', range.toIso)

  if (error) {
    log.warn(
      { code: 'admin_analytics_kpi_failed', msg: error?.message ?? 'unknown' },
      'getAnalyticsKpi: query failed',
    )
    return EMPTY_ANALYTICS_KPI
  }

  if (!data || !Array.isArray(data) || data.length === 0) {
    // Empty result is not an error — it's the expected state until
    // the nightly job populates the table. Don't log a warn.
    log.info(
      { code: 'admin_analytics_kpi_empty', rangeKind: range.kind, days: range.days },
      'getAnalyticsKpi: no analytics_daily rows in range',
    )
    return EMPTY_ANALYTICS_KPI
  }

  return aggregateKpi(data as unknown as DailyRow[])
}

/** Sum the rows into the 6-KPI shape. Pure — testable in isolation. */
export function aggregateKpi(rows: DailyRow[]): AnalyticsKpi {
  let revenue = 0
  let orders = 0
  let refunds = 0
  let chargebacks = 0
  let signups = 0
  let visitors = 0

  for (const row of rows) {
    revenue += coerceCents(row.revenue_cents)
    orders += coerceCount(row.order_count)
    refunds += coerceCount(row.refund_count)
    chargebacks += coerceCount(row.chargeback_count)
    signups += coerceCount(row.signup_count)
    visitors += coerceCount(row.visitor_count)
  }

  const refundRatePct = orders > 0 ? (refunds / orders) * 100 : 0
  const chargebackRatePct = orders > 0 ? (chargebacks / orders) * 100 : 0
  const conversionRatePct = visitors > 0 ? (orders / visitors) * 100 : 0

  return {
    totalRevenueCents: revenue,
    totalOrders: orders,
    newSignups: signups,
    conversionRatePct: round2(conversionRatePct),
    refundRatePct: round2(refundRatePct),
    chargebackRatePct: round2(chargebackRatePct),
  }
}

/** Round to 2 decimal places without floating-point drift. */
function round2(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 100) / 100
}