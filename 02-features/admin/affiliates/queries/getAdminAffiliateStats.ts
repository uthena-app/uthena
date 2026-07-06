// getAdminAffiliateStats.ts — 5-card stats row for /admin/affiliates.
//
// Calls the SECURITY DEFINER RPC `get_admin_affiliate_stats()`.
// Auth-gated at the application layer (requireRole) — the RPC also
// enforces via `is_admin()`. Fails soft to EMPTY_AFFILIATE_STATS on
// any read error. Exposes a small `affiliateStatsChips` helper for the
// <AffiliateStatsCards> RSC.

import 'server-only'
import { requireRole } from '@foundations/auth/guards'
import { getServerSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'
import { EMPTY_AFFILIATE_STATS, type AffiliateStats } from '../types'

const log = loggerFor({ component: 'admin.affiliates.getAdminAffiliateStats' })

type RawRpcRow = {
  total: number | string
  pending: number | string
  suspended: number | string
  approved_this_month: number | string
  this_month_commission_paid_cents: number | string
}

/** Defensive bigint/string → number coercion. */
function coerceBigint(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0
  if (typeof v === 'number') return Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0
  const parsed = Number(v)
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0
}

export async function getAdminAffiliateStats(): Promise<AffiliateStats> {
  await requireRole(['admin', 'super_admin'])
  const supabase = await getServerSupabase()

  const { data, error } = await supabase.rpc('get_admin_affiliate_stats' as never, {} as never)

  if (error) {
    log.warn(
      { code: 'admin_affiliate_stats_failed', msg: error.message },
      'getAdminAffiliateStats: RPC failed',
    )
    return EMPTY_AFFILIATE_STATS
  }

  // The RPC returns a single row.
  const row = ((data ?? []) as unknown as RawRpcRow[])[0]
  if (!row) return EMPTY_AFFILIATE_STATS

  return {
    total: coerceBigint(row.total),
    pending: coerceBigint(row.pending),
    suspended: coerceBigint(row.suspended),
    approvedThisMonth: coerceBigint(row.approved_this_month),
    thisMonthCommissionPaidCents: coerceBigint(row.this_month_commission_paid_cents),
  }
}

/**
 * UI chip helper for the stats row. Returns a 5-element array in the
 * canonical display order so the RSC just maps over the result.
 */
export function affiliateStatsChips(stats: AffiliateStats): {
  key: string
  label: string
  count: number
}[] {
  return [
    { key: 'total', label: 'Total affiliates', count: stats.total },
    { key: 'pending', label: 'Pending review', count: stats.pending },
    { key: 'suspended', label: 'Suspended', count: stats.suspended },
    {
      key: 'approvedThisMonth',
      label: 'Approved this month',
      count: stats.approvedThisMonth,
    },
    {
      key: 'thisMonthCommissionPaidCents',
      label: 'Commission paid (MTD)',
      count: stats.thisMonthCommissionPaidCents,
    },
  ]
}