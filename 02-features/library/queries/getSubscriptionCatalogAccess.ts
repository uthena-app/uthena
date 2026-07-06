// getSubscriptionCatalogAccess.ts — for the catalog display (P8.2),
// figure out which products the current user gets via their active
// Personal Access subscription. The /browse, /products/[slug],
// /collections, /bundles, and /search pages call this in parallel
// with the catalog query and use the returned `Set` to render an
// "Included with Personal Access" badge on the right cards.
//
// We intentionally narrow to `access_source === 'subscription'`
// rather than `user_accessible_products` as a whole — products the
// user has already purchased are not "included with" the
// subscription, they're already in the user's library. Surfacing
// every accessible product would render a misleading badge on
// purchases the user already owns.
//
// Implementation: one RPC roundtrip (`user_accessible_products`)
// returns all accessible products + the `access_source` discriminator
// (per migration 0009). We filter in JS to `subscription` only and
// build a `Set<number>` for O(1) membership lookup at render time.
//
// P8.3 added `hasActiveSubscription: boolean` to the result so the
// product detail page can render a subscriber-only upgrade CTA
// without a second RPC. The boolean is derived from the same data:
// any row with `access_source === 'subscription'` means the user has
// an active Personal Access subscription (the subscription tier
// covers the whole catalog per P5.8, so any subscription-source row
// implies an active subscription). Fail-closed on RPC error —
// returns false so the gate stays locked by default.
//
// Fail-soft: any RPC error returns an empty Set (the catalog page
// still renders, badges simply don't appear). This matches the
// `getUserLibrary` fail-soft contract from P5.8.
//
// Anon users: returns an empty Set + hasActiveSubscription:false
// without hitting the DB. The catalog pages always call this — the
// cost is one Set construction, not a network round-trip.

import 'server-only'
import { cache } from 'react'
import { getServerSupabase } from '@foundations/data/supabase'
import { getSessionUser } from '@foundations/auth/guards'
import { loggerFor } from '@foundations/log/pino'

const log = loggerFor({ component: 'library.getSubscriptionCatalogAccess' })

export type SubscriptionCatalogAccess = {
  /** Set of product ids the current user accesses via an active subscription. */
  productIds: Set<number>
  /** Total accessible products (any source) — used by the page header subtitle. */
  totalAccessible: number
  /**
   * Whether the current user has an active Personal Access subscription
   * (P8.3). Derived from the same RPC payload as `productIds` — true iff
   * at least one row with `access_source === 'subscription'` is
   * returned. False on anon, no-data, and RPC error (fail-closed).
   * The product detail page uses this to gate subscriber-only content.
   */
  hasActiveSubscription: boolean
}

/**
 * Read the current user's subscription-accessible product set + the
 * boolean "is the user a subscriber?" derived from it.
 *
 * Server-only; safe to call from RSC pages without a try/catch — the
 * function never throws. Returned Set is a fresh instance per call
 * (mutating it from a consumer doesn't affect future reads, since
 * React's `cache()` deduplicates the underlying RPC but the wrapping
 * Set is rebuilt on each invocation).
 */
export const getSubscriptionCatalogAccess = cache(
  async (): Promise<SubscriptionCatalogAccess> => {
    const user = await getSessionUser()
    if (!user) return { productIds: new Set(), totalAccessible: 0, hasActiveSubscription: false }
    const supabase = await getServerSupabase()
    const { data, error } = await supabase.rpc('user_accessible_products', {
      p_user_id: user.id,
    })
    if (error) {
      log.warn(
        { code: 'get_subscription_catalog_failed', msg: error.message },
        'getSubscriptionCatalogAccess failed — catalog will render without badges',
      )
      return { productIds: new Set(), totalAccessible: 0, hasActiveSubscription: false }
    }
    const rows = (data ?? []) as Array<{
      product_id: number
      access_source: 'subscription' | 'purchase' | 'admin_grant' | 'free_promo'
    }>
    const productIds = new Set<number>()
    let hasActiveSubscription = false
    for (const row of rows) {
      if (row.access_source === 'subscription') {
        productIds.add(row.product_id)
        hasActiveSubscription = true
      }
    }
    return { productIds, totalAccessible: rows.length, hasActiveSubscription }
  },
)