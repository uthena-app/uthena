// resolveAnonCart.ts — read the anon-cookie cart + join live pricing
// to produce the same `CartLine[]` shape the auth cart returns.
//
// Called by `getCart()` and `getCartSubtotalCents()` on the anon
// branch. The shape is identical to the auth branch so the rest of
// the cart feature (CartDrawer, /cart page, /api/cart route) doesn't
// need to know whether the lines came from the DB or the cookie.
//
// Live pricing — we re-fetch `products` + `product_pricing` on every
// call so a price change between add-to-cart and checkout reflects.
// Matches the auth cart's "join live against pricing" pattern.
// Storing the price in the cookie would create a mismatch with the
// live DB and is one more surface to harden; the cost is one
// PostgREST read per anon cart render (capped at 50 product ids).
//
// Dedup — multiple anon lines can target the same product at
// different licenses. We fetch each product once and filter the
// pricing rows by license in JS. Products with no active pricing
// for the requested license are silently dropped (mirrors the
// auth cart's "tier removed/disabled → skip silently" behavior).

import 'server-only'
import { getServerSupabase } from '@foundations/data/supabase'
import { getSessionUser } from '@foundations/auth/guards'
import { loggerFor } from '@foundations/log/pino'
import {
  anonLineId,
  readAnonCart,
  type AnonCart,
  type AnonCartLine,
} from '@foundations/cookies/anon-cart'
import type { CartLine } from './getCart'

const log = loggerFor({ component: 'cart.resolveAnonCart' })

/**
 * Fetch live pricing for the given product IDs in one PostgREST read.
 * Returns a map keyed by product ID with the resolved product + the
 * list of active pricing tiers. Empty map when no IDs supplied.
 */
async function fetchLivePricing(
  productIds: number[],
): Promise<Map<number, LivePricingRow>> {
  if (productIds.length === 0) return new Map()
  const supabase = await getServerSupabase()
  const { data, error } = await supabase
    .from('products')
    .select(
      `
      id, slug, title, thumbnail_url, status, category_id,
      category:categories ( slug, name ),
      pricing:product_pricing!inner ( license, price_cents, compare_at_cents, is_active, subscriber_discount_bps )
    `,
    )
    .eq('status', 'published')
    .eq('pricing.is_active', true)
    .in('id', productIds)
  if (error) {
    log.warn(
      { code: 'anon_pricing_failed', msg: error.message },
      'resolveAnonCart pricing fetch failed',
    )
    return new Map()
  }
  const byId = new Map<number, LivePricingRow>()
  for (const row of data ?? []) {
    byId.set(row.id, row as unknown as LivePricingRow)
  }
  return byId
}

type LivePricingRow = {
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

/**
 * Build a CartLine from an anon-cookie line + the live pricing row
 * for its product. Returns null when the product is unpublished, the
 * license is no longer available, or the product was deleted — the
 * caller skips it (same as the auth branch's "skip silently").
 */
function buildCartLine(line: AnonCartLine, product: LivePricingRow): CartLine | null {
  const tier = product.pricing.find(
    (p) => p.license === line.l && p.is_active,
  )
  if (!tier) return null
  const unit = tier.price_cents
  return {
    id: anonLineId(line.p, line.l), // opaque string id, distinguishes from auth ids
    product_id: line.p,
    slug: product.slug,
    title: product.title,
    thumbnail_url: product.thumbnail_url,
    category_slug: product.category?.slug ?? null,
    category_name: product.category?.name ?? null,
    license: line.l,
    quantity: line.q,
    unit_price_cents: unit,
    line_total_cents: unit * line.q,
    compare_at_cents: tier.compare_at_cents,
    subscriber_discount_bps: tier.subscriber_discount_bps ?? null,
    added_at: line.a,
  }
}

/**
 * Resolve the anon-cookie cart into the canonical CartLine[] shape.
 * Returns an empty array when no cookie, bad signature, or zero
 * lines. Products / licenses that are no longer available are
 * silently dropped (and the cookie is NOT rewritten here — that
 * happens lazily on the next mutation).
 *
 * Cost: one PostgREST read per call (capped at 50 product ids via
 * the cookie's ANON_CART_MAX_LINES cap).
 */
export async function resolveAnonCart(): Promise<CartLine[]> {
  const user = await getSessionUser()
  if (user) return [] // auth path — this resolver is anon-only
  const cookie = await readAnonCart()
  if (!cookie || cookie.lines.length === 0) return []
  // Dedup product IDs before the PostgREST call.
  const productIds = [...new Set(cookie.lines.map((l) => l.p))]
  const byId = await fetchLivePricing(productIds)
  const lines: CartLine[] = []
  for (const line of cookie.lines) {
    const product = byId.get(line.p)
    if (!product) continue // unpublished or deleted → drop silently
    const built = buildCartLine(line, product)
    if (built) lines.push(built)
  }
  return lines
}

/**
 * Resolve the anon-cookie cart into the same shape as the auth
 * `getCartSubtotalCents()` (just a number). Used by the anon branch
 * of getCartSubtotalCents.
 */
export async function resolveAnonCartSubtotalCents(): Promise<number> {
  const lines = await resolveAnonCart()
  let total = 0
  for (const l of lines) total += l.line_total_cents
  return total
}

/**
 * Resolve the anon-cookie cart's item count (sum of quantities).
 * Used by the anon branch of getCartCount and the site-header badge.
 */
export async function resolveAnonCartCount(): Promise<number> {
  const cookie = await readAnonCart()
  if (!cookie) return 0
  let count = 0
  for (const line of cookie.lines) count += line.q
  return count
}

/**
 * Re-export the anon-cart type so callers importing from
 * `@features/cart` don't need a direct dep on the cookie module.
 */
export type { AnonCart }