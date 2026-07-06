// getAdminRefundStats.ts — server query wrapping the SECURITY DEFINER
// RPC `get_admin_refund_stats()` shipped in migration 0059.
//
// Auth gate: requireRole(['admin', 'super_admin']) at the application
// layer (the RPC also gates via `is_admin()` — both are belt-and-
// suspenders). Fails soft to EMPTY_REFUND_STATS on any read error so
// the page can render the cards even if the RPC is down.
//
// The 5 cards match the spec: total / pending / approved / succeeded /
// failed (with `canceled` also surfaced as a 6th data point for
// transparency, not rendered as a card by default — the UI renders the
// 5 spec'd cards + a small "Cancelados: N" footer line).

import 'server-only'
import { requireRole } from '@foundations/auth/guards'
import { getServerSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'
import { EMPTY_REFUND_STATS, type RefundStats } from '../types'

const log = loggerFor({ component: 'admin.refunds.getAdminRefundStats' })

type RawRpcRow = {
  total: number | string
  pending: number | string
  approved: number | string
  succeeded: number | string
  failed: number | string
  canceled: number | string
}

/** Defensive bigint/string → number coercion. */
function coerceBigint(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0
  if (typeof v === 'number') return Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0
  const parsed = Number(v)
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0
}

function mapRow(raw: RawRpcRow | null | undefined): RefundStats {
  const r = raw ?? ({} as RawRpcRow)
  return {
    total: coerceBigint(r.total),
    pending: coerceBigint(r.pending),
    approved: coerceBigint(r.approved),
    succeeded: coerceBigint(r.succeeded),
    failed: coerceBigint(r.failed),
    canceled: coerceBigint(r.canceled),
  }
}

/**
 * Reads the 5-card stats row for the refund queue. The RPC returns a
 * single row; the data layer here normalizes that into the
 * `RefundStats` shape and fail-softs on any error.
 */
export async function getAdminRefundStats(): Promise<RefundStats> {
  await requireRole(['admin', 'super_admin'])
  const supabase = await getServerSupabase()

  try {
    const { data, error } = await supabase.rpc(
      'get_admin_refund_stats' as never,
      {} as never,
    )
    if (error) {
      log.warn(
        { code: 'admin_refund_stats_failed', msg: error.message },
        'getAdminRefundStats: RPC failed',
      )
      return EMPTY_REFUND_STATS
    }
    const rawRows = (data ?? []) as unknown as RawRpcRow[]
    const first = rawRows[0]
    if (!first) return EMPTY_REFUND_STATS
    return mapRow(first)
  } catch (err) {
    log.warn(
      { code: 'admin_refund_stats_threw', msg: err instanceof Error ? err.message : 'unknown' },
      'getAdminRefundStats: unexpected error',
    )
    return EMPTY_REFUND_STATS
  }
}