// getSiteHeaderData — single server-side aggregator for the global
// site header. Renders on every page, so the three independent reads
// (auth + cart count + published product count for the nav badge)
// fan out in parallel via Promise.all. React's `cache()` dedupes the
// individual calls if other code on the same request also reads them.
//
// No new query logic here — this is a thin composition so the
// SiteHeader component stays declarative.

import 'server-only'
import { cache } from 'react'
import { getSessionUser, type SessionUser } from '@foundations/auth/guards'
import { getCartCount } from '@features/cart/queries/getCartCount'
import { getPublishedProductCount } from '@features/catalog/queries'

export type SiteHeaderData = {
  user: SessionUser | null
  cartCount: number
  publishedProductCount: number
}

export const getSiteHeaderData = cache(async (): Promise<SiteHeaderData> => {
  const [user, cartCount, publishedProductCount] = await Promise.all([
    getSessionUser(),
    getCartCount(),
    getPublishedProductCount(),
  ])
  return { user, cartCount, publishedProductCount }
})
