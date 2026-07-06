// getAdminCustomerStats.ts — returns the 5-card stats row for the
// admin customers page.
//
// Calls the SECURITY DEFINER RPC `get_admin_customer_stats()`. Auth-gated
// to admin / super_admin at the application layer (defense in depth;
// the RPC also enforces via `is_admin()` in its body). Fails soft to
// zero counts if the RPC errors out — the page still renders the table.

import 'server-only'
import { requireRole } from '@foundations/auth/guards'
import { getServerSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'
import {
  CUSTOMER_ROLE_FILTERS,
  EMPTY_CUSTOMER_STATS,
  type CustomerStats,
} from '../types'

const log = loggerFor({ component: 'admin.customers.getAdminCustomerStats' })

type StatsRpcRow = {
  total: number | string
  active: number | string
  suspended: number | string
  banned: number | string
  new_this_month: number | string
}

/** Defensive bigint/string → number coercion for the stats row. */
function coerceCount(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0
  if (typeof v === 'number') return Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0
  const parsed = Number(v)
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0
}

/** Returns the 5-card stats row for /admin/customers. */
export async function getAdminCustomerStats(): Promise<CustomerStats> {
  await requireRole(['admin', 'super_admin'])
  const supabase = await getServerSupabase()
  const { data, error } = await supabase.rpc('get_admin_customer_stats' as never)

  if (error || !data) {
    log.warn(
      { code: 'admin_customer_stats_failed', msg: error?.message },
      'getAdminCustomerStats: RPC failed',
    )
    return EMPTY_CUSTOMER_STATS
  }

  // The RPC returns one row with 5 bigint fields. PostgREST may serialize
  // as an array (function returning a row) or as an object (function
  // returning SETOF). Handle both.
  const raw = data as unknown
  let row: StatsRpcRow | null = null
  if (Array.isArray(raw) && raw.length > 0) {
    row = raw[0] as StatsRpcRow
  } else if (raw && typeof raw === 'object' && 'total' in (raw as Record<string, unknown>)) {
    row = raw as StatsRpcRow
  }

  if (!row) {
    log.info(
      { code: 'admin_customer_stats_empty' },
      'getAdminCustomerStats: RPC returned no rows',
    )
    return EMPTY_CUSTOMER_STATS
  }

  return {
    total: coerceCount(row.total),
    active: coerceCount(row.active),
    suspended: coerceCount(row.suspended),
    banned: coerceCount(row.banned),
    newThisMonth: coerceCount(row.new_this_month),
  }
}

/**
 * Filter-chip labels + counts for the UI. A separate shape from
 * CustomerStats because the chips want `(label, count, isActive)`
 * tuples the UI can render directly.
 */
export type StatsChip = {
  key: 'total' | 'active' | 'suspended' | 'banned' | 'newThisMonth'
  label: string
  count: number
}

export function customerStatsChips(stats: CustomerStats): StatsChip[] {
  return [
    { key: 'total', label: 'Total', count: stats.total },
    { key: 'active', label: 'Active', count: stats.active },
    { key: 'suspended', label: 'Suspended', count: stats.suspended },
    { key: 'banned', label: 'Banned', count: stats.banned },
    { key: 'newThisMonth', label: 'New this month', count: stats.newThisMonth },
  ]
}

// Re-export so the consumers don't need to import from `types` separately.
export { CUSTOMER_ROLE_FILTERS }