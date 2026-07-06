// getCategoryStats.ts — the 5 stat cards on the categories page.
// Computes total / top-level / sub-category counts, total products
// in the tree, and total revenue_30d in the tree. Reads from the same
// data the tree query uses; we recompute (cheap, ≤ 17 rows for the
// seeded data) instead of joining queries.

import 'server-only'
import { getServerSupabase } from '@foundations/data/supabase'
import { requireRole } from '@foundations/auth/guards'
import { loggerFor } from '@foundations/log/pino'
import type { CategoryStats } from '../types'

const log = loggerFor({ component: 'admin.categories.getCategoryStats' })

type CategoryRow = {
  id: number
  parent_id: number | null
  product_count_cache: number
}

export async function getCategoryStats(): Promise<CategoryStats> {
  const empty: CategoryStats = {
    total: 0,
    topLevel: 0,
    sub: 0,
    totalProducts: 0,
    totalRevenue30d: 0,
  }
  await requireRole(['admin', 'super_admin'])
  const supabase = await getServerSupabase()

  const { data: cats, error: catErr } = await supabase
    .from('categories')
    .select('id, parent_id, product_count_cache')
  if (catErr || !cats) {
    log.warn({ code: 'cat_stats_failed', msg: catErr?.message }, 'getCategoryStats: categories')
    return empty
  }

  const rows = cats as unknown as CategoryRow[]
  let topLevel = 0
  let sub = 0
  let totalProducts = 0
  for (const r of rows) {
    if (r.parent_id == null) topLevel += 1
    else sub += 1
    totalProducts += r.product_count_cache ?? 0
  }

  // Revenue: best effort. We can't easily compute the SUM of
  // order_items across the whole tree without a join, and the
  // product_count_cache includes drafts/unpublished. The tree
  // query already computed the per-category 30d revenue; the stat
  // card is allowed to be 0 in v1 if the RPC is missing.
  let totalRevenue30d = 0
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const { data: revenueRows, error: revErr } = await supabase
    .from('order_items')
    .select('unit_price_cents, refunded_cents, order:orders!inner(status, created_at)')
    .gte('order.created_at', since)
    .in('order.status', ['paid', 'partially_refunded'])
  if (!revErr && revenueRows) {
    for (const r of revenueRows as unknown as Array<{
      unit_price_cents: number
      refunded_cents: number
    }>) {
      totalRevenue30d += Math.max(0, (r.unit_price_cents ?? 0) - (r.refunded_cents ?? 0))
    }
  } else {
    log.info(
      { code: 'cat_stats_revenue_unavailable', msg: revErr?.message },
      'getCategoryStats: revenue fallback to 0',
    )
  }
  // Suppress unused-var warning for AggregateRow type
  return {
    total: rows.length,
    topLevel,
    sub,
    totalProducts,
    totalRevenue30d,
  }
}
