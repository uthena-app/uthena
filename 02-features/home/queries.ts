// Home feature — server-only queries. The home page is a public,
// read-only marketing surface. All queries here are RLS-aware and
// ISR-cached at the page level (revalidate=60s).
//
// This file is server-only; do not import from a client component.

import 'server-only'
import { cache } from 'react'
import { getServerSupabase } from '@foundations/data/supabase'
import { getPublishedProductCount, getActiveCategories } from '@features/catalog/queries'

/**
 * Public product statistics used by the home hero (and any future
 * "as seen on the homepage" surface). All four values come from
 * published data or cached aggregates — never hard-coded.
 *
 * - `courseCount`: live count of `products` where `status = 'published'`.
 *   Same source as `getPublishedProductCount()`; we re-derive to keep
 *   the call site self-contained.
 * - `partnerCount`: count of `partners` where the partner has at least
 *   one published product. Capped at a sensible display label.
 * - `paidOutCents`: sum of `payout_ledger.amount_cents` for `status = 'paid'`
 *   entries, in cents. Rendered as `$X.XM` on the home page.
 * - `avgRating`: rounded average of `products.avg_rating` where the
 *   product has at least one review. Null when no reviews exist.
 *
 * The shape mirrors what the spec's "Stat strip" section needs.
 */
export type PublicProductStats = {
  courseCount: number
  partnerCount: number
  paidOutCents: number
  avgRating: number | null
}

export const getPublicProductStats = cache(async (): Promise<PublicProductStats> => {
  const supabase = await getServerSupabase()

  const [courseCount, partners, paidOut, ratings] = await Promise.all([
    getPublishedProductCount(),
    supabase
      .from('partners')
      .select('id, products!inner(id)', { count: 'exact', head: true })
      .eq('products.status', 'published'),
    supabase
      .from('payout_ledger')
      .select('amount_cents')
      .eq('status', 'paid'),
    supabase
      .from('products')
      .select('avg_rating')
      .not('avg_rating', 'is', null)
      .gt('review_count', 0),
  ])

  const paidOutCents = (paidOut.data ?? []).reduce(
    (sum, row) => sum + (row.amount_cents ?? 0),
    0,
  )

  const ratingValues = (ratings.data ?? [])
    .map((r) => r.avg_rating)
    .filter((v): v is number => typeof v === 'number')
  const avgRating =
    ratingValues.length > 0
      ? Math.round((ratingValues.reduce((a, b) => a + b, 0) / ratingValues.length) * 100) / 100
      : null

  return {
    courseCount,
    partnerCount: partners.count ?? 0,
    paidOutCents,
    avgRating,
  }
})

/**
 * Featured home-page art cells. When the catalog has real data, we
 * render the 4 most recently published products with their license tag.
 * When the catalog is empty (e.g. local Supabase offline), we fall back
 * to the mockup's hero placeholder cells so the visual hierarchy stays
 * intact.
 *
 * Returning a list of plain data lets the Hero component decide between
 * "real product" and "fallback placeholder" rendering without juggling
 * nulls and DB errors in JSX.
 */
export type HeroArtCell = {
  title: string
  licenseTag: 'PLR' | 'MRR'
}

const FALLBACK_HERO_CELLS: HeroArtCell[] = [
  { title: 'AI Personal Branding', licenseTag: 'PLR' },
  { title: 'Python Data Science', licenseTag: 'MRR' },
  { title: 'Deep Learning', licenseTag: 'PLR' },
  { title: 'AI Copywriting', licenseTag: 'PLR' },
]

export const getHomeHeroCells = cache(async (): Promise<HeroArtCell[]> => {
  const supabase = await getServerSupabase()
  const { data, error } = await supabase
    .from('products')
    .select(
      'title, pricing:product_pricing ( license, is_default, is_active )',
    )
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(4)
  if (error || !data || data.length < 4) return FALLBACK_HERO_CELLS
  const cells: HeroArtCell[] = []
  for (const row of data) {
    const pricing = (row.pricing ?? []) as Array<{
      license: string
      is_default: boolean
      is_active: boolean
    }>
    const active = pricing.find((p) => p.is_active && p.is_default) ?? pricing.find((p) => p.is_active)
    const license = active?.license?.toUpperCase()
    const tag: 'PLR' | 'MRR' = license === 'MRR' || license === 'RR' ? 'MRR' : 'PLR'
    cells.push({ title: row.title ?? 'Course', licenseTag: tag })
  }
  return cells.length === 4 ? cells : FALLBACK_HERO_CELLS
})

// Re-export catalog queries so the home page has a single import root
// for its data needs (queries that are still owned by `catalog`).
export { getActiveCategories }
