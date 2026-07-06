// getCategoryTree.ts — returns the full category tree (max 2 levels
// deep), sorted by display_order asc within each parent. Each node
// includes the cached product_count, plus sales_30d and revenue_30d
// computed from orders joined to order_items joined to products.
//
// The query runs as a single RLS-aware read per Supabase call. The
// server-side admin policy (`categories_admin_all`) is what allows
// the admin client to see every category; the public read policy
// also works for admins via the existing pattern. We use the
// RLS-aware server client so the query is consistent with the rest
// of the admin area.
//
// Implementation: two queries + JS tree assembly. We use the
// RLS-aware server client. The sales/revenue aggregates are computed
// in Postgres via a single grouped select, then joined to the
// category tree by id.

import 'server-only'
import { getServerSupabase } from '@foundations/data/supabase'
import { requireRole } from '@foundations/auth/guards'
import { loggerFor } from '@foundations/log/pino'
import type { CategoryNode, CategoryLookup } from '../types'

const log = loggerFor({ component: 'admin.categories.getCategoryTree' })

type CategoryRow = {
  id: number
  slug: string
  name: string
  description: string | null
  parent_id: number | null
  display_order: number
  product_count_cache: number
  created_at: string
}

type AggregateRow = {
  category_id: number
  sales_30d: number
  revenue_30d: number
}

/** Returns the full category tree (depth ≤ 2), sorted by display_order. */
export async function getCategoryTree(): Promise<CategoryNode[]> {
  await requireRole(['admin', 'super_admin'])
  const supabase = await getServerSupabase()

  // 1) All categories (RLS = admin or public-read; admin sees all).
  const { data: categories, error: catErr } = await supabase
    .from('categories')
    .select(
      'id, slug, name, description, parent_id, display_order, product_count_cache, created_at',
    )
    .order('display_order', { ascending: true })
    .order('id', { ascending: true })

  if (catErr) {
    log.warn({ code: 'cat_query_failed', msg: catErr.message }, 'getCategoryTree: categories')
    return []
  }

  // 2) Aggregates: last 30 days of paid orders, grouped by category.
  //    We hit products for the category_id and order_items for revenue.
  //    Path: order_items.product_id -> products.category_id.
  //    This is done in one Postgres query via an inner view.
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const { data: aggregates, error: aggErr } = await supabase.rpc(
    'admin_category_aggregates_30d' as never,
    { since: thirtyDaysAgo } as never,
  )

  let aggRows: AggregateRow[] = []
  if (aggErr) {
    // The RPC may not exist yet (it'll be added in a follow-up
    // migration). Fall back to a client-side aggregate: fetch the
    // last 30 days of order_items joined to products, then bucket
    // by category in JS. This is slower but still O(rows-in-30d).
    log.info(
      { code: 'cat_rpc_unavailable', msg: aggErr.message },
      'getCategoryTree: RPC fallback to client-side aggregate',
    )
    aggRows = await fallbackAggregates(supabase, thirtyDaysAgo)
  } else {
    aggRows = (aggregates ?? []) as AggregateRow[]
  }

  const aggByCategory = new Map<number, AggregateRow>()
  for (const row of aggRows) {
    aggByCategory.set(row.category_id, row)
  }

  // 3) Build the tree.
  const lookup: CategoryLookup = {}
  for (const row of categories ?? []) {
    const r = row as unknown as CategoryRow
    const agg = aggByCategory.get(r.id)
    lookup[r.id] = {
      id: r.id,
      slug: r.slug,
      name: r.name,
      description: r.description,
      parent_id: r.parent_id,
      display_order: r.display_order,
      product_count_cache: r.product_count_cache,
      created_at: r.created_at,
      sales_30d: agg?.sales_30d ?? 0,
      revenue_30d: agg?.revenue_30d ?? 0,
      children: [],
    }
  }

  // 4) Wire parent/children. Top-level nodes are returned; sub-nodes
  //    are referenced from their parent's `children` array.
  const roots: CategoryNode[] = []
  for (const node of Object.values(lookup)) {
    if (node.parent_id == null) {
      roots.push(node)
    } else {
      const parent = lookup[node.parent_id]
      if (parent) {
        parent.children.push(node)
      } else {
        // Orphan (parent_id points to a missing row). Promote to root
        // so the admin sees it.
        roots.push(node)
      }
    }
  }

  // 5) Sort each level by display_order.
  sortByDisplayOrder(roots)
  return roots
}

function sortByDisplayOrder(nodes: CategoryNode[]): void {
  nodes.sort((a, b) => {
    if (a.display_order !== b.display_order) {
      return a.display_order - b.display_order
    }
    return a.id - b.id
  })
  for (const n of nodes) {
    if (n.children.length > 0) sortByDisplayOrder(n.children)
  }
}

type Supabase = Awaited<ReturnType<typeof getServerSupabase>>

async function fallbackAggregates(supabase: Supabase, since: string): Promise<AggregateRow[]> {
  // Pull the last 30 days of order_items joined to products. We need:
  //   - product.category_id (to bucket)
  //   - order_items.unit_price_cents - order_items.refunded_cents (revenue)
  //   - order_items.id (count for sales)
  //   - orders.status (filter to 'paid' and 'partially_refunded')
  // PostgREST can join orders -> order_items -> products in one query.
  const { data, error } = await supabase
    .from('order_items')
    .select(
      'id, unit_price_cents, refunded_cents, product:products!inner(category_id), order:orders!inner(status, created_at)',
    )
    .gte('order.created_at', since)
    .in('order.status', ['paid', 'partially_refunded'])

  if (error || !data) {
    log.warn(
      { code: 'cat_fallback_failed', msg: error?.message },
      'getCategoryTree: fallback aggregate failed',
    )
    return []
  }

  const map = new Map<number, AggregateRow>()
  for (const row of data as unknown as Array<{
    id: number
    unit_price_cents: number
    refunded_cents: number
    product: { category_id: number } | null
  }>) {
    const cat = row.product?.category_id
    if (cat == null) continue
    const cur = map.get(cat) ?? { category_id: cat, sales_30d: 0, revenue_30d: 0 }
    cur.sales_30d += 1
    cur.revenue_30d += Math.max(0, (row.unit_price_cents ?? 0) - (row.refunded_cents ?? 0))
    map.set(cat, cur)
  }
  return Array.from(map.values())
}
