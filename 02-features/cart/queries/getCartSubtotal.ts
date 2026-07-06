// getCartSubtotal.ts — sum of unit_price_cents * quantity across active
// cart lines, in cents. Joins live against product_pricing for current
// prices (same source of truth as the /cart page render).
//
// Used by the checkout feature to pre-validate the cart total. The webhook
// is the final authority on what gets charged, but this catches
// user-facing drift (price went up between add and click).
//
// P4.2 — anon-cookie cart: for unauthenticated visitors we read the
// anon cookie via `resolveAnonCartSubtotalCents` and return the same
// value. The auth branch is unchanged.

import 'server-only'
import { cache } from 'react'
import { getServerSupabase } from '@foundations/data/supabase'
import { getSessionUser } from '@foundations/auth/guards'
import { resolveAnonCartSubtotalCents } from './resolveAnonCart'

export const getCartSubtotalCents = cache(async (): Promise<number> => {
  const user = await getSessionUser()
  if (!user) return resolveAnonCartSubtotalCents()

  const supabase = await getServerSupabase()
  const { data, error } = await supabase
    .from('cart_items')
    .select(
      `
      quantity, license,
      product:products!inner ( status,
        pricing:product_pricing!inner ( license, price_cents, is_active )
      )
    `,
    )
    .eq('user_id', user.id)
    .eq('status', 'active')
    .eq('product.status', 'published')
    .eq('product.pricing.is_active', true)
  if (error || !data) return 0

  let total = 0
  for (const row of data) {
    const product = (row as any).product as
      | {
          pricing: Array<{ license: string; price_cents: number; is_active: boolean }>
        }
      | null
    if (!product) continue
    const tier = product.pricing.find((p) => p.license === row.license && p.is_active)
    if (!tier) continue
    total += tier.price_cents * row.quantity
  }
  return total
})
