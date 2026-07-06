// getAdminPartnerStats.ts — returns the 5-card stats row for the
// admin partners page.
//
// Calls the SECURITY DEFINER RPC `get_admin_partner_stats()`. Auth-gated
// to admin / super_admin at the application layer (defense in depth;
// the RPC also enforces via `is_admin()` in its body). Fails soft to
// zero counts if the RPC errors out — the page still renders the table.

import 'server-only'
import { requireRole } from '@foundations/auth/guards'
import { getServerSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'
import { EMPTY_PARTNER_STATS, type PartnerStats } from '../types'

const log = loggerFor({ component: 'admin.partners.getAdminPartnerStats' })

type StatsRpcRow = {
  total: number | string
  pending: number | string
  suspended: number | string
  approved_this_month: number | string
  lifetime_revenue_cents: number | string
}

/** Defensive bigint/string → number coercion for the stats row. */
function coerceCount(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0
  if (typeof v === 'number') return Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0
  const parsed = Number(v)
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0
}

/** Returns the 5-card stats row for /admin/partners. */
export async function getAdminPartnerStats(): Promise<PartnerStats> {
  await requireRole(['admin', 'super_admin'])
  const supabase = await getServerSupabase()
  const { data, error } = await supabase.rpc('get_admin_partner_stats' as never)

  if (error || !data) {
    log.warn(
      { code: 'admin_partner_stats_failed', msg: error?.message },
      'getAdminPartnerStats: RPC failed',
    )
    return EMPTY_PARTNER_STATS
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
      { code: 'admin_partner_stats_empty' },
      'getAdminPartnerStats: RPC returned no rows',
    )
    return EMPTY_PARTNER_STATS
  }

  return {
    total: coerceCount(row.total),
    pending: coerceCount(row.pending),
    suspended: coerceCount(row.suspended),
    approvedThisMonth: coerceCount(row.approved_this_month),
    lifetimeRevenueCents: coerceCount(row.lifetime_revenue_cents),
  }
}

/**
 * Filter-chip labels + counts for the UI. A separate shape from
 * PartnerStats because the chips want `(label, count, isActive)`
 * tuples the UI can render directly.
 */
export type PartnerStatsChip = {
  key: 'total' | 'pending' | 'suspended' | 'approvedThisMonth' | 'lifetimeRevenue'
  label: string
  count: number | string
}

export function partnerStatsChips(stats: PartnerStats): PartnerStatsChip[] {
  return [
    { key: 'total', label: 'Total partners', count: stats.total },
    { key: 'pending', label: 'Pending review', count: stats.pending },
    { key: 'suspended', label: 'Suspended', count: stats.suspended },
    { key: 'approvedThisMonth', label: 'Approved this month', count: stats.approvedThisMonth },
    {
      key: 'lifetimeRevenue',
      label: 'Lifetime partner revenue',
      // Display as currency-formatted — the page handles the
      // formatting via formatMoney.
      count: stats.lifetimeRevenueCents,
    },
  ]
}