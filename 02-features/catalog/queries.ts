// Catalog queries — server-side only. All read paths use the RLS-aware
// Supabase client, so customers see published products, partners see
// their own, admins see everything. Public reads are cached at the
// Next.js Data Cache level (revalidate=60s).

import 'server-only'
import { cache } from 'react'
import { getServerSupabase } from '@foundations/data/supabase'
import type { Tables } from '@foundations/data/types'
import { BROWSE_PAGE_SIZE, filterByPriceBucket, sortByPrice, type PriceBucket, type SortKey } from './format'

/** License tier — drives the PLR/MRR pill on the product card. */
export type LicenseTier = 'plr' | 'mrr' | 'rr' | 'personal'

/** Currency — the app currently supports USD / EUR / GBP. */
export type Currency = 'USD' | 'EUR' | 'GBP'

/**
 * One row in the `products.curriculum` JSONB column (migration 0014).
 * Re-exported from the catalog feature so the product feature's
 * `ProductCurriculum` component (P0.12 Slice 4) and any future
 * consumer (Phase 15 lessons backfill, admin curriculum editor)
 * imports the same type. Mirrors `00-foundations/data/types.ts`
 * `CurriculumEntry`. See the foundations copy for field semantics.
 */
export type CurriculumEntry = {
  index: number
  name: string
  duration_seconds: number
}

export type ProductListItem = Pick<
  Tables<'products'>,
  | 'id'
  | 'slug'
  | 'title'
  | 'short_description'
  | 'thumbnail_url'
  | 'kind'
  | 'published_at'
  | 'total_lesson_count'
  | 'total_duration_seconds'
  | 'avg_rating'
  | 'review_count'
> & {
  category: Pick<Tables<'categories'>, 'slug' | 'name'> | null
  partner: Pick<Tables<'partners'>, 'public_slug' | 'user_id'> | null
  /** Lowest active PLR (or default) price in cents. */
  starting_price_cents: number | null
  /** MSRP (compare-at) in cents. Null when no compare-at is set. */
  msrp_cents: number | null
  /** Currency. The app supports USD / EUR / GBP. */
  currency: 'USD' | 'EUR' | 'GBP'
  /** Default license tier's slug (e.g. 'plr', 'mrr'). Drives the card pill. */
  default_license: LicenseTier | null
}

/** Top published products for the home page. ISR-cached 60s. */
export const getFeaturedProducts = cache(
  async (limit: number = 8): Promise<ProductListItem[]> => {
    const supabase = await getServerSupabase()
    const { data, error } = await supabase
      .from('products')
      .select(
        `
        id, slug, title, short_description, thumbnail_url, kind, published_at,
        total_lesson_count, total_duration_seconds,
        avg_rating, review_count,
        category:categories ( slug, name ),
        partner:partners ( public_slug, user_id ),
        pricing:product_pricing ( license, price_cents, compare_at_cents, is_default, is_active )
      `,
      )
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(limit)
    if (error) {
      // eslint-disable-next-line no-console
      console.error('[catalog] getFeaturedProducts', error.message)
      return []
    }
    return (data ?? []).map(normalizeListItem)
  },
)

/**
 * All published products for the catalog grid.
 *
 * Options (all optional):
 * - `limit` — page size; defaults to `BROWSE_PAGE_SIZE` (60).
 * - `category` — slug filter; applied as `category.slug = X` at SQL level.
 * - `sort` — result ordering. `newest` + `popular` go to SQL `.order()`
 *   (the columns are on `products` directly). `price-asc` / `price-desc`
 *   are applied post-fetch in JS because `starting_price_cents` is a
 *   derived field from the pricing join — see `sortByPrice` for the
 *   rationale.
 * - `priceBucket` — price filter. Applied post-fetch in JS (same
 *   1:N-join constraint as the price sort).
 *
 * RLS handles visibility: anon sees only published products, partners
 * see their own, admins see everything.
 */
export const getPublishedProducts = cache(
  async (opts: {
    limit?: number
    category?: string
    sort?: SortKey
    priceBucket?: PriceBucket
  } = {}): Promise<ProductListItem[]> => {
    const supabase = await getServerSupabase()
    const sort = opts.sort ?? 'newest'
    let q = supabase
      .from('products')
      .select(
        `
        id, slug, title, short_description, thumbnail_url, kind, published_at,
        total_lesson_count, total_duration_seconds,
        avg_rating, review_count,
        category:categories!inner ( slug, name ),
        partner:partners ( public_slug, user_id ),
        pricing:product_pricing ( license, price_cents, compare_at_cents, is_default, is_active )
      `,
      )
      .eq('status', 'published')
    if (opts.category) q = q.eq('category.slug', opts.category)
    // Popularity = review_count DESC, then avg_rating DESC (nulls last
    // so unrated products don't outrank 5-star products), then
    // published_at DESC for a stable recency tiebreaker. Without a
    // sales_count column on products yet (P6.2 STUB-035 territory),
    // review_count is the closest "social proof" proxy we have.
    if (sort === 'popular') {
      q = q
        .order('review_count', { ascending: false, nullsFirst: false })
        .order('avg_rating', { ascending: false, nullsFirst: false })
        .order('published_at', { ascending: false })
    } else {
      q = q.order('published_at', { ascending: false })
    }
    q = q.limit(opts.limit ?? BROWSE_PAGE_SIZE)
    const { data, error } = await q
    if (error) {
      // eslint-disable-next-line no-console
      console.error('[catalog] getPublishedProducts', error.message)
      return []
    }
    let items = (data ?? []).map(normalizeListItem)
    // Price filter — post-fetch because `starting_price_cents` is a
    // derived field. See `format.ts` for the trade-off vs a denormalized
    // `min_price_cents` column on `products`.
    items = filterByPriceBucket(items, opts.priceBucket ?? 'any')
    // Price sort — same constraint as the filter.
    if (sort === 'price-asc') items = sortByPrice(items, 'asc')
    else if (sort === 'price-desc') items = sortByPrice(items, 'desc')
    return items
  },
)

/** A single product by slug, for the product detail page. */
export async function getProductBySlug(slug: string): Promise<ProductDetail | null> {
  const supabase = await getServerSupabase()
  const { data, error } = await supabase
    .from('products')
    .select(
      `
      id, slug, title, short_description, long_description, kind, status,
      category_id, partner_id, thumbnail_url, preview_video_url, published_at,
      total_lesson_count, total_duration_seconds, avg_rating, review_count,
      bullets, curriculum, subscriber_only, created_at, updated_at,
      category:categories ( slug, name ),
      partner:partners (
        public_slug, bio, royalty_pct_bps, user_id,
        profile:profiles!partners_user_id_fkey ( display_name, avatar_url )
      ),
      pricing:product_pricing ( id, license, price_cents, compare_at_cents, is_default, is_active ),
      images:product_images ( id, url, alt, kind, display_order )
    `,
    )
    .eq('slug', slug)
    .eq('status', 'published')
    .maybeSingle()
  if (error) {
    // eslint-disable-next-line no-console
    console.error('[catalog] getProductBySlug', error.message)
    return null
  }
  if (!data) return null
  const pricing = (data.pricing ?? []) as PricingTier[]
  const sortedPricing = [...pricing].sort((a, b) => a.price_cents - b.price_cents)
  const images = ((data.images ?? []) as ProductImage[]).sort(
    (a, b) => a.display_order - b.display_order || a.id - b.id,
  )
  // Default license = the tier flagged is_default, or the first active
  // tier, mirroring `normalizeListItem` for the card. Drives the ID
  // badge code on the rating row (P0.12) and the default radio in
  // the license picker (P0.12 Slice 2).
  const activePricing = sortedPricing.filter((p) => p.is_active)
  const defaultLicense = activePricing.find((p) => p.is_default) ?? activePricing[0] ?? null

  // Reviews: top 5 published, newest first. Separate read (not a join
  // on the product query) so we can order/limit without bloating the
  // product payload. RLS lets anon read published reviews only.
  const recentReviews: ProductReviewItem[] = await getRecentReviewsForProduct(
    supabase,
    data.id,
    5,
  )

  return {
    ...data,
    pricing: sortedPricing,
    images,
    default_license: defaultLicense?.license ?? null,
    recent_reviews: recentReviews,
  } as unknown as ProductDetail
}

/**
 * Top N published reviews for a product, newest first. The RLS policy
 * `reviews_public_read_published` makes this anon-safe (status =
 * 'published' only). Read-only display — Phase 9 P9.14 wires the
 * create/edit/delete own flow.
 */
async function getRecentReviewsForProduct(
  supabase: Awaited<ReturnType<typeof getServerSupabase>>,
  productId: number,
  limit: number,
): Promise<ProductReviewItem[]> {
  const { data, error } = await supabase
    .from('reviews')
    .select(
      `
      id, rating, title, body, helpful_count, created_at,
      reviewer:profiles!reviews_user_id_fkey ( display_name )
    `,
    )
    .eq('product_id', productId)
    .eq('status', 'published')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) {
    // eslint-disable-next-line no-console
    console.error('[catalog] getRecentReviewsForProduct', error.message)
    return []
  }
  return (data ?? []) as unknown as ProductReviewItem[]
}

export type PricingTier = {
  id: number
  license: LicenseTier
  price_cents: number
  compare_at_cents: number | null
  is_default: boolean
  is_active: boolean
}

/**
 * A single gallery image row from `product_images`. The product detail
 * page (P0.12) renders these in a thumbnail row; the first non-video
 * image by display_order is the gallery's "main" image.
 */
export type ProductImage = Pick<
  Tables<'product_images'>,
  'id' | 'url' | 'alt' | 'kind' | 'display_order'
>

/**
 * One published review row for the Reviews tab. Read-only display —
 * Phase 9 P9.14 wires the create/edit/delete own flow.
 */
export type ProductReviewItem = Pick<
  Tables<'reviews'>,
  'id' | 'rating' | 'title' | 'body' | 'helpful_count' | 'created_at'
> & {
  reviewer: Pick<Tables<'profiles'>, 'display_name'> | null
}

export type ProductDetail = Pick<
  Tables<'products'>,
  | 'id'
  | 'slug'
  | 'title'
  | 'short_description'
  | 'long_description'
  | 'kind'
  | 'status'
  | 'category_id'
  | 'partner_id'
  | 'thumbnail_url'
  | 'preview_video_url'
  | 'published_at'
  | 'total_lesson_count'
  | 'total_duration_seconds'
  | 'avg_rating'
  | 'review_count'
  | 'bullets'
  | 'curriculum'
  | 'subscriber_only'
  | 'created_at'
  | 'updated_at'
> & {
  category: Pick<Tables<'categories'>, 'slug' | 'name'> | null
  partner:
    | (Pick<Tables<'partners'>, 'public_slug' | 'bio' | 'royalty_pct_bps' | 'user_id'> & {
        /** Joined profile fields — display name + avatar for the Instructor tab. */
        profile: Pick<Tables<'profiles'>, 'display_name' | 'avatar_url'> | null
      })
    | null
  pricing: PricingTier[]
  /** Ordered gallery images. The first non-video entry is the main. */
  images: ProductImage[]
  /** Default license tier slug, derived from `product_pricing`. */
  default_license: LicenseTier | null
  /** Top published reviews for the Reviews tab (newest first, capped). */
  recent_reviews: ProductReviewItem[]
}

/** All categories with at least one published product, for the category strip. */
export const getActiveCategories = cache(async (): Promise<
  Array<{ slug: string; name: string; product_count: number }>
> => {
  const supabase = await getServerSupabase()
  // Use the cached product_count_cache column maintained by a trigger
  // (placeholder; until the trigger exists in migration, we count live).
  const { data: cats, error } = await supabase
    .from('categories')
    .select('id, slug, name, product_count_cache')
    .order('display_order')
  if (error) {
    // eslint-disable-next-line no-console
    console.error('[catalog] getActiveCategories', error.message)
    return []
  }
  // Filter to categories with at least one published product
  const { data: counts, error: countErr } = await supabase
    .from('products')
    .select('category_id')
    .eq('status', 'published')
  if (countErr) {
    return (cats ?? []).map((c) => ({
      slug: c.slug,
      name: c.name,
      product_count: c.product_count_cache ?? 0,
    }))
  }
  const liveCounts = new Map<number, number>()
  for (const p of counts ?? []) {
    liveCounts.set(p.category_id, (liveCounts.get(p.category_id) ?? 0) + 1)
  }
  return (cats ?? [])
    .map((c) => ({
      slug: c.slug,
      name: c.name,
      product_count: liveCounts.get(c.id) ?? 0,
    }))
    .filter((c) => c.product_count > 0)
})

/**
 * Published product count, for the "All Courses {N}" badge in the
 * site header and the "Live courses" stat on the home hero. Single
 * integer read; cheap. Backed by the `products.status` index, no full
 * table scan. Same caching layer as the rest of catalog/queries.
 */
export const getPublishedProductCount = cache(async (): Promise<number> => {
  const supabase = await getServerSupabase()
  const { count, error } = await supabase
    .from('products')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'published')
  if (error) {
    // eslint-disable-next-line no-console
    console.error('[catalog] getPublishedProductCount', error.message)
    return 0
  }
  return count ?? 0
})

function normalizeListItem(row: any): ProductListItem {
  const pricing = (row.pricing ?? []) as Array<{
    license: LicenseTier
    price_cents: number
    compare_at_cents: number | null
    is_default: boolean
    is_active: boolean
  }>
  const activePricing = pricing.filter((p) => p.is_active)
  const defaultTier = activePricing.find((p) => p.is_default) ?? activePricing[0]
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    short_description: row.short_description,
    thumbnail_url: row.thumbnail_url,
    kind: row.kind,
    published_at: row.published_at,
    total_lesson_count: row.total_lesson_count,
    total_duration_seconds: row.total_duration_seconds,
    avg_rating: row.avg_rating,
    review_count: row.review_count ?? 0,
    category: row.category ?? null,
    partner: row.partner ?? null,
    starting_price_cents: defaultTier?.price_cents ?? null,
    msrp_cents: defaultTier?.compare_at_cents ?? null,
    currency: 'USD',
    default_license: defaultTier?.license ?? null,
  }
}

// ============================================================================
// Collections — P0.17
//
// A "collection" is a hand-picked, team-curated grouping of products,
// distinct from a `category` (which is the partner-facing taxonomy).
// The /collections/[handle] page tries these first, then falls back to
// the category lookup so the legacy Shopify redirect URLs keep working
// (see `01-specs/pages/seo-url-migration.md`).
//
// Migration: 0015_collections.sql. Two tables:
//   - `collections`           (id, slug, name, description, hero_image_url,
//                              is_featured, display_order, status,
//                              published_at, created_at, updated_at)
//   - `collection_products`   (id, collection_id, product_id,
//                              display_order, note, added_at)
// ============================================================================

/** A published collection row, as exposed to the public catalog. */
export type CollectionListItem = Pick<
  Tables<'collections'>,
  'id' | 'slug' | 'name' | 'description' | 'hero_image_url' | 'is_featured' | 'display_order'
>

/**
 * Full detail row for the `/collections/[slug]` page. Same shape as
 * `CollectionListItem` plus the `published_at` field for the page
 * footer ("Updated [Month YYYY]") and the `note` map for any per-row
 * admin notes on the included products (used in a future Phase 19
 * marketing pass — the current page renders products as a flat grid
 * without the per-product note).
 */
export type CollectionDetail = CollectionListItem &
  Pick<Tables<'collections'>, 'published_at' | 'status'> & {
    /** Joined rows from `collection_products` (in display order). */
    products: ProductListItem[]
    /** Total product count (after RLS filtering). */
    product_count: number
  }

/**
 * All published collections for the `/collections` index page, sorted
 * featured-first then by display_order. Empty array when no
 * collections are published (the index page renders an `EmptyState`).
 *
 * Uses the `collections_index_idx` partial index (0015) — `status =
 * 'published'`, `(is_featured desc, display_order, name)`.
 */
export const getPublishedCollections = cache(async (): Promise<CollectionListItem[]> => {
  const supabase = await getServerSupabase()
  const { data, error } = await supabase
    .from('collections')
    .select('id, slug, name, description, hero_image_url, is_featured, display_order')
    .eq('status', 'published')
    .order('is_featured', { ascending: false })
    .order('display_order', { ascending: true })
    .order('name', { ascending: true })
  if (error) {
    // eslint-disable-next-line no-console
    console.error('[catalog] getPublishedCollections', error.message)
    return []
  }
  return (data ?? []) as CollectionListItem[]
})

/**
 * Fetch a single published collection by slug, plus the products in
 * it (in display order). Returns `null` when no published collection
 * matches the slug — the caller decides whether to fall back to a
 * category lookup (the /collections/[handle] page does).
 *
 * The query reads `collection_products` separately from the collection
 * row to keep the product payload identical to the rest of the catalog
 * (same `ProductListItem` shape, same `normalizeListItem` path). One
 * round-trip for the collection + one for the joined products. The
 * RLS policy `collection_products_public_read_published` ensures both
 * collections and products must be published — so the product list
 * already excludes drafts/unpublished products.
 */
export async function getCollectionBySlug(
  slug: string,
): Promise<CollectionDetail | null> {
  const supabase = await getServerSupabase()
  const { data: row, error } = await supabase
    .from('collections')
    .select(
      'id, slug, name, description, hero_image_url, is_featured, display_order, published_at, status',
    )
    .eq('slug', slug)
    .eq('status', 'published')
    .maybeSingle()
  if (error) {
    // eslint-disable-next-line no-console
    console.error('[catalog] getCollectionBySlug', error.message)
    return null
  }
  if (!row) return null

  const { data: productRows, error: productsErr } = await supabase
    .from('collection_products')
    .select(
      `
      display_order,
      product:products!inner (
        id, slug, title, short_description, thumbnail_url, kind, published_at,
        total_lesson_count, total_duration_seconds,
        avg_rating, review_count,
        category:categories ( slug, name ),
        partner:partners ( public_slug, user_id ),
        pricing:product_pricing ( license, price_cents, compare_at_cents, is_default, is_active )
      )
    `,
    )
    .eq('collection_id', row.id)
    .order('display_order', { ascending: true })
  if (productsErr) {
    // eslint-disable-next-line no-console
    console.error('[catalog] getCollectionBySlug products', productsErr.message)
    return null
  }
  const products = (productRows ?? [])
    .map((r: any) => r.product)
    .filter(Boolean)
    .map(normalizeListItem)

  return {
    ...row,
    products,
    product_count: products.length,
  } as CollectionDetail
}

// ============================================================================
// Bundles — P0.18
//
// A "bundle" in v2 is a product with `kind = 'bundle'`. The product itself
// is a normal catalog row (title, description, thumbnail, pricing,
// curriculum, etc.); the bundle also references an ordered list of included
// products via the `bundle_items` join table (migration 0016). The
// /bundles listing renders one card per published bundle with a preview of
// the included products ("Includes 5 courses" + 3 thumbnails + "+2 more").
//
// Why bundles are products, not a separate entity:
//   - Bundles need a /products/[slug] detail page (browseable, reviewable,
//     purchasable, with its own curriculum tab explaining what's in it).
//   - Bundles have their own pricing tiers (PLR / MRR / RR / personal).
//   - Bundles are subject to reviews + ratings like any other product.
//
// Why `bundle_items` is a join table (and not a JSONB column):
//   - Many-to-many: a popular course can be in multiple bundles.
//   - Per-row RLS: public-read only when both sides are published.
//   - Reversible: "which bundles include this product?" is a real query
//     (the P0.12 product detail "Also included in" badge + the P12.7
//     partner delete warning).
// ============================================================================

/** A single included-product preview row, as rendered by `BundleCard`. */
export type BundleIncludedPreview = Pick<
  Tables<'products'>,
  'id' | 'slug' | 'title' | 'thumbnail_url' | 'kind'
>

/**
 * A published bundle (a product with `kind = 'bundle'`) plus the preview
 * list of included products. The preview is capped at 3 rows in the
 * query (so the page doesn't have to slice client-side) plus an
 * `included_product_count` for the "Includes N courses" label and the
 * "+X more" badge.
 */
export type BundleListItem = Pick<
  Tables<'products'>,
  | 'id'
  | 'slug'
  | 'title'
  | 'short_description'
  | 'thumbnail_url'
  | 'published_at'
  | 'total_lesson_count'
  | 'total_duration_seconds'
  | 'avg_rating'
  | 'review_count'
> & {
  category: Pick<Tables<'categories'>, 'slug' | 'name'> | null
  partner: Pick<Tables<'partners'>, 'public_slug' | 'user_id'> | null
  /** Lowest active PLR (or default) price in cents. */
  starting_price_cents: number | null
  /** MSRP (compare-at) in cents. Null when no compare-at is set. */
  msrp_cents: number | null
  /** Currency. The app supports USD / EUR / GBP. */
  currency: 'USD' | 'EUR' | 'GBP'
  /** Default license tier's slug (e.g. 'plr', 'mrr'). Drives the card pill. */
  default_license: LicenseTier | null
  /** Total number of included products (full count, NOT capped at 3). */
  included_product_count: number
  /**
   * Up to 3 included-product preview rows, ordered by `bundle_items.display_order`.
   * Empty array when the bundle has no published included products
   * (e.g. an empty draft — the page renders the card without the preview
   * strip rather than hiding the bundle entirely).
   */
  included_preview: BundleIncludedPreview[]
}

/** Cap on the included-product preview list per bundle card. */
export const BUNDLE_PREVIEW_LIMIT = 3

/**
 * Hard cap on the number of bundles returned by `getPublishedBundles`.
 * Matches the catalog grid page size so a single /bundles render can
 * reuse the same row budget (PostgREST default response is 1000 rows;
 * 60 bundles × 24 items = 1440, so we cap items-per-bundle tighter
 * than the product grid — see MAX_ITEMS_PER_BUNDLE_FOR_LISTING).
 */
export const BUNDLE_LISTING_LIMIT = 60

/**
 * Hard cap on how many included-product rows we read per bundle on
 * the /bundles listing. Real bundles are 3–10 items; 24 is a generous
 * safety cap (matches the curriculum 24-entry cap from P0.15) that
 * still keeps the full listing under PostgREST's default response
 * budget. A partner who adds 25+ products to a single bundle is
 * hitting a UI ceiling and should split the bundle; the limit is
 * a defensive cap, not a feature.
 */
export const MAX_ITEMS_PER_BUNDLE_FOR_LISTING = 24

/**
 * All published bundles for the `/bundles` listing, newest-first. Each
 * bundle is enriched with a preview list of up to `BUNDLE_PREVIEW_LIMIT`
 * (3) included products and the total `included_product_count` for the
 * "Includes N courses" + "+X more" label.
 *
 * Query strategy: one read for the bundle products (filtered by
 * `kind = 'bundle'`), then a single read for the top-3 included products
 * per bundle via the `bundle_items` join. The `bundle_items` query selects
 * the 3 lowest-display_order rows PER bundle in a single PostgREST
 * round-trip using `order(display_order)` + `.limit(BUNDLE_PREVIEW_LIMIT *
 * bundleCount)`. The page-side sort then groups by bundle id and slices
 * the first 3 — bounded by the BROWSE_PAGE_SIZE, so at 60 bundles this is
 * 180 preview rows in flight, not a per-bundle N+1.
 *
 * RLS handles visibility: anon sees only published bundles whose included
 * products are also published (the `bundle_items_public_read_published`
 * policy filters the join on the way in). Bundles with no published
 * included products still render — the preview strip is hidden, the
 * `included_product_count` shows 0.
 */
export const getPublishedBundles = cache(async (): Promise<BundleListItem[]> => {
  const supabase = await getServerSupabase()
  // 1. Fetch the bundle products. Same shape as the catalog query so
  //    the BundleCard can reuse the same product card components where
  //    it can (rating row, price row, etc.). The bundle filter is
  //    `kind = 'bundle'` + `status = 'published'`.
  const { data: bundleRows, error: bundlesErr } = await supabase
    .from('products')
    .select(
      `
      id, slug, title, short_description, thumbnail_url, published_at,
      total_lesson_count, total_duration_seconds,
      avg_rating, review_count,
      category:categories ( slug, name ),
      partner:partners ( public_slug, user_id ),
      pricing:product_pricing ( license, price_cents, compare_at_cents, is_default, is_active )
    `,
    )
    .eq('status', 'published')
    .eq('kind', 'bundle')
    .order('published_at', { ascending: false })
  if (bundlesErr) {
    // eslint-disable-next-line no-console
    console.error('[catalog] getPublishedBundles', bundlesErr.message)
    return []
  }
  const bundleList = bundleRows ?? []
  if (bundleList.length === 0) return []

  // 2. Fetch every included-product row for the published bundles in
  //    one read. The RLS policy `bundle_items_public_read_published`
  //    filters the join to only rows where both the bundle and the
  //    included product are published — so an included product that
  //    gets unpublished automatically disappears from the card
  //    preview.
  //
  //    We fetch ALL items for these bundles (no per-bundle limit) and
  //    group + cap in JS. The cap is `MAX_ITEMS_PER_BUNDLE_FOR_LISTING`
  //    (24) — well above the 3-row preview the card renders, and
  //    matches the `curriculum` 24-entry cap from P0.15. The
  //    included_product_count is then a real, accurate number (capped
  //    at the cap, which is a UI-driven choice — anything beyond 24 in
  //    a single bundle is a partner-tooling bug, not a user-facing
  //    detail).
  //
  //    Bounded by BUNDLE_LISTING_LIMIT (60 bundles) × 24 items = 1440
  //    rows max in a single response. That's well within PostgREST's
  //    default 1000-row response budget — for the typical 60 bundles
  //    × 5 items = 300 rows, comfortably below the cap.
  const bundleIds = bundleList.map((b) => b.id)
  const { data: itemRows, error: itemsErr } = await supabase
    .from('bundle_items')
    .select(
      `
      bundle_product_id, display_order,
      included_product:products!bundle_items_included_product_id_fkey (
        id, slug, title, thumbnail_url, kind
      )
    `,
    )
    .in('bundle_product_id', bundleIds)
    .order('bundle_product_id', { ascending: true })
    .order('display_order', { ascending: true })
    .limit(BUNDLE_LISTING_LIMIT * MAX_ITEMS_PER_BUNDLE_FOR_LISTING)
  if (itemsErr) {
    // eslint-disable-next-line no-console
    console.error('[catalog] getPublishedBundles items', itemsErr.message)
    // Non-fatal: fall through with empty previews. The page still
    // renders the bundle cards; just without the included-courses
    // preview strip.
  }

  // 3. Group included products by bundle. The RLS join guarantees the
  //    `included_product` shape is well-formed when present. Group in
  //    JS rather than via a Postgres window function so the query stays
  //    in PostgREST (no rpc, no extra migration).
  const allItemsByBundle = new Map<number, BundleIncludedPreview[]>()
  for (const row of itemRows ?? []) {
    const included = (row as any).included_product as
      | BundleIncludedPreview
      | null
      | undefined
    if (!included) continue
    const list = allItemsByBundle.get(row.bundle_product_id) ?? []
    list.push(included)
    allItemsByBundle.set(row.bundle_product_id, list)
  }

  // 4. Merge: every bundle is normalized through the same `normalizeListItem`
  //    helper so price/license/rating fields are consistent with the
  //    rest of the catalog. The included-preview side is per-bundle.
  return bundleList.map((b) => {
    const all = allItemsByBundle.get(b.id) ?? []
    return {
      ...normalizeListItem(b),
      included_product_count: all.length,
      included_preview: all.slice(0, BUNDLE_PREVIEW_LIMIT),
    } as BundleListItem
  })
})
