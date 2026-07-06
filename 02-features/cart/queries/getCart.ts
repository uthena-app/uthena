// getCart.ts — read the current user's cart with live pricing.
//
// Returns a normalized view: cart line + product + current active pricing
// for the line's license. Joins live against `product_pricing` so a price
// change between add-to-cart and checkout is reflected.
//
// P4.2 — anon-cookie cart: for unauthenticated visitors we resolve the
// cookie-backed cart (`resolveAnonCart`) and return the same shape. The
// auth branch is unchanged. `id` is `number` for auth rows (the DB
// primary key) and a synthesized `anon:<product_id>:<license>` string
// for anon-cookie rows; downstream code uses the same field name.

import 'server-only'
import { cache } from 'react'
import { getServerSupabase } from '@foundations/data/supabase'
import { getSessionUser } from '@foundations/auth/guards'
import { loggerFor } from '@foundations/log/pino'
import { resolveAnonCart } from './resolveAnonCart'

const log = loggerFor({ component: 'cart.getCart' })

export type CartLine = {
  /** cart_items.id (auth) or the synthesized `anon:<product_id>:<license>`
   *  string id (anon-cookie). See `parseAnonLineId` for parsing. */
  id: number | string
  product_id: number
  slug: string
  title: string
  thumbnail_url: string | null
  category_slug: string | null
  category_name: string | null
  license: 'plr' | 'mrr' | 'rr' | 'personal'
  quantity: number
  /** Per-unit price for the line's current license, in cents. */
  unit_price_cents: number
  /** unit_price_cents * quantity, in cents. */
  line_total_cents: number
  /** Compare-at price (was/now), in cents. Null if no discount. */
  compare_at_cents: number | null
  /** P5.9 — Per-(product,license) override of the subscriber discount
   *  basis points (e.g. 1500 = 15%). Null = inherit the platform default
   *  from `getSubscriberDiscountContext().discountBps`. Explicit 0 = the
   *  partner has opted this tier OUT of the subscriber discount. */
  subscriber_discount_bps: number | null
  added_at: string
}

export const getCart = cache(async (): Promise<CartLine[]> => {
  const user = await getSessionUser()
  if (!user) return resolveAnonCart()

  const supabase = await getServerSupabase()
  const { data, error } = await supabase
    .from('cart_items')
    .select(
      `
      id, product_id, license, quantity, added_at,
      product:products!inner (
        id, slug, title, thumbnail_url, status, category_id,
        category:categories ( slug, name ),
        pricing:product_pricing!inner ( license, price_cents, compare_at_cents, is_active, subscriber_discount_bps )
      )
    `,
    )
    .eq('user_id', user.id)
    .eq('status', 'active')
    .eq('product.status', 'published')
    .eq('product.pricing.is_active', true)
    .order('updated_at', { ascending: false })

  if (error) {
    log.warn({ code: 'get_cart_failed', msg: error.message }, 'getCart failed')
    return []
  }

  const lines: CartLine[] = []
  for (const row of data ?? []) {
    const product = (row as any).product as
      | {
          id: number
          slug: string
          title: string
          thumbnail_url: string | null
          category: { slug: string; name: string } | null
          pricing: Array<{
            license: 'plr' | 'mrr' | 'rr' | 'personal'
            price_cents: number
            compare_at_cents: number | null
            is_active: boolean
            subscriber_discount_bps: number | null
          }>
        }
      | null
    if (!product) continue
    const tier = product.pricing.find((p) => p.license === row.license && p.is_active)
    if (!tier) continue // pricing row removed/disabled — skip silently
    const unit = tier.price_cents
    lines.push({
      id: row.id,
      product_id: product.id,
      slug: product.slug,
      title: product.title,
      thumbnail_url: product.thumbnail_url,
      category_slug: product.category?.slug ?? null,
      category_name: product.category?.name ?? null,
      license: row.license,
      quantity: row.quantity,
      unit_price_cents: unit,
      line_total_cents: unit * row.quantity,
      compare_at_cents: tier.compare_at_cents,
      subscriber_discount_bps: tier.subscriber_discount_bps ?? null,
      added_at: row.added_at,
    })
  }
  return lines
})
