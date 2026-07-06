// getCartCount.ts — small int for the layout-level nav badge.
// Hot path: rendered on every page via SiteHeader.
//
// Auth branch uses a SQL aggregate (`get_cart_quantity_sum` RPC) so
// the network is one row back (not N rows for N cart lines), and
// the existing `cart_items_user_status_idx (user_id, status)` covers
// the predicate (index-only scan).
//
// P4.2 — anon-cookie branch reads the cookie and sums quantities
// in JS. The cookie is tiny (< 1 KB) so the loop is trivial; the
// only DB cost would be when we later resolve pricing, but the
// count badge doesn't need that — the cookie is the source of
// truth for the count.

import 'server-only'
import { cache } from 'react'
import { getServerSupabase } from '@foundations/data/supabase'
import { getSessionUser } from '@foundations/auth/guards'
import { resolveAnonCartCount } from './resolveAnonCart'

export const getCartCount = cache(async (): Promise<number> => {
  const user = await getSessionUser()
  if (!user) return resolveAnonCartCount()
  const supabase = await getServerSupabase()
  // PostgREST: select the aggregate as a column. The shape is
  // { quantity_sum: number | null }.
  const { data, error } = await supabase
    .rpc('get_cart_quantity_sum', { p_user_id: user.id })
    .maybeSingle<{ quantity_sum: number | null }>()
  if (error || !data) return 0
  return Number(data.quantity_sum ?? 0)
})
