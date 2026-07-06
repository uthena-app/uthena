// getAdminOrderStats.ts — 5-card stats row for /admin/orders.
//
// Calls the SECURITY DEFINER RPC `get_admin_order_stats()`. Auth-gated
// at the application layer (requireRole) — the RPC also enforces via
// `is_admin()` (per migration 0057). Fails soft to EMPTY_ORDER_STATS on
// any read error. Exposes a small `orderStatsChips` helper for the
// <OrderStatsCards> RSC.

import 'server-only'
import { requireRole } from '@foundations/auth/guards'
import { getServerSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'
import { EMPTY_ORDER_STATS, type OrderStats } from '../types'

const log = loggerFor({ component: 'admin.orders.getAdminOrderStats' })

type RawRpcRow = {
  total: number | string
  paid: number | string
  refunded: number | string
  paid_revenue_mtd_cents: number | string
  failed: number | string
}

/** Defensive bigint/string → number coercion. */
function coerceBigint(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0
  if (typeof v === 'number') return Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0
  const parsed = Number(v)
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0
}

export async function getAdminOrderStats(): Promise<OrderStats> {
  await requireRole(['admin', 'super_admin'])
  const supabase = await getServerSupabase()

  const { data, error } = await supabase.rpc('get_admin_order_stats' as never, {} as never)

  if (error) {
    log.warn(
      { code: 'admin_order_stats_failed', msg: error.message },
      'getAdminOrderStats: RPC failed',
    )
    return EMPTY_ORDER_STATS
  }

  // The RPC returns a single row.
  const row = ((data ?? []) as unknown as RawRpcRow[])[0]
  if (!row) return EMPTY_ORDER_STATS

  return {
    total: coerceBigint(row.total),
    paid: coerceBigint(row.paid),
    refunded: coerceBigint(row.refunded),
    paidRevenueMtdCents: coerceBigint(row.paid_revenue_mtd_cents),
    failed: coerceBigint(row.failed),
  }
}

/**
 * UI chip helper for the stats row. Returns a 5-element array in the
 * canonical display order so the RSC just maps over the result.
 */
export function orderStatsChips(stats: OrderStats): {
  key: string
  label: string
  value: number | string
  isMoney?: boolean
}[] {
  return [
    { key: 'total', label: 'Total orders', value: stats.total },
    { key: 'paid', label: 'Paid orders', value: stats.paid },
    { key: 'refunded', label: 'Refunded orders', value: stats.refunded },
    {
      key: 'paidRevenueMtdCents',
      label: 'Paid revenue (MTD)',
      value: stats.paidRevenueMtdCents,
      isMoney: true,
    },
    { key: 'failed', label: 'Failed orders', value: stats.failed },
  ]
}
