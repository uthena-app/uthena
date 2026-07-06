// Formatters for catalog display. Server-safe.
//
// Browse-polish types (P0.16): the `/browse` page accepts `sort`,
// `price`, and `density` URL search params. Each parser here is a
// safe-fallback — bad or unknown input collapses to the default
// rather than throwing, so a typo or a stale URL never breaks the
// page (the "garbage in, defaults out" pattern).

import type { ProductListItem } from './queries'

/** Sort keys supported by the `/browse` results head. */
export type SortKey = 'newest' | 'popular' | 'price-asc' | 'price-desc'

/** Default sort when no `?sort=` is present. */
export const DEFAULT_SORT: SortKey = 'newest'

const VALID_SORTS: readonly SortKey[] = ['newest', 'popular', 'price-asc', 'price-desc']

/**
 * Parse a `?sort=` value into a valid SortKey. Falls back to the
 * default on missing / unknown input — never throws. Bad URLs degrade
 * silently to the newest sort, not to an error page.
 */
export function parseSort(raw: string | undefined | null): SortKey {
  if (!raw) return DEFAULT_SORT
  return (VALID_SORTS as readonly string[]).includes(raw) ? (raw as SortKey) : DEFAULT_SORT
}

/** Display label for each SortKey, used in the sort dropdown options. */
export const SORT_LABELS: Record<SortKey, string> = {
  newest: 'Newest',
  popular: 'Best selling',
  'price-asc': 'Price low → high',
  'price-desc': 'Price high → low',
}

/**
 * Price filter buckets for `/browse?price=...`. The buckets are
 * defined in cents (the canonical money unit per AGENTS.md). `any`
 * means no filter.
 */
export type PriceBucket = 'any' | 'free' | 'under-50' | 'under-100'

/** Default price filter when no `?price=` is present. */
export const DEFAULT_PRICE_BUCKET: PriceBucket = 'any'

const VALID_PRICE_BUCKETS: readonly PriceBucket[] = ['any', 'free', 'under-50', 'under-100']

/** Parse a `?price=` value into a valid PriceBucket. Safe fallback. */
export function parsePriceBucket(raw: string | undefined | null): PriceBucket {
  if (!raw) return DEFAULT_PRICE_BUCKET
  return (VALID_PRICE_BUCKETS as readonly string[]).includes(raw)
    ? (raw as PriceBucket)
    : DEFAULT_PRICE_BUCKET
}

/** Display label for each PriceBucket. */
export const PRICE_BUCKET_LABELS: Record<PriceBucket, string> = {
  any: 'Any price',
  free: 'Free',
  'under-50': 'Under $50',
  'under-100': 'Under $100',
}

/**
 * Numeric ceiling (in cents) for a bucket. `any` returns `Infinity`
 * so `price <= ceiling` is always true. `free` returns 0 so only
 * products with a $0 starting price match.
 */
export const PRICE_BUCKET_CEILINGS: Record<PriceBucket, number> = {
  any: Number.POSITIVE_INFINITY,
  free: 0,
  'under-50': 5_000,
  'under-100': 10_000,
}

/** Filter a product list by price bucket. Pure, returns a new array. */
export function filterByPriceBucket(
  products: ProductListItem[],
  bucket: PriceBucket,
): ProductListItem[] {
  if (bucket === 'any') return products
  const ceiling = PRICE_BUCKET_CEILINGS[bucket]
  return products.filter((p) => {
    const price = p.starting_price_cents
    if (price == null) return false
    return price <= ceiling
  })
}

/**
 * Density toggle for the product grid. `comfortable` is the
 * mockup-faithful 3-column layout; `compact` packs 4 columns.
 * The class is applied to the grid wrapper and CSS does the rest.
 */
export type BrowseDensity = 'comfortable' | 'compact'

/** Default density when no `?density=` is present. */
export const DEFAULT_DENSITY: BrowseDensity = 'comfortable'

const VALID_DENSITIES: readonly BrowseDensity[] = ['comfortable', 'compact']

/** Parse a `?density=` value into a valid BrowseDensity. Safe fallback. */
export function parseDensity(raw: string | undefined | null): BrowseDensity {
  if (!raw) return DEFAULT_DENSITY
  return (VALID_DENSITIES as readonly string[]).includes(raw)
    ? (raw as BrowseDensity)
    : DEFAULT_DENSITY
}

/**
 * Sort a product list by price (low→high or high→low). Pure, stable.
 *
 * Why client-side sort instead of PostgREST `.order()`: the
 * `starting_price_cents` field is derived from the `product_pricing`
 * join (we pick the default tier, or the lowest-priced active tier).
 * PostgREST's order-on-foreign-column works on a 1:1 relationship but
 * not cleanly on a 1:N join. Doing it in JS after `normalizeListItem`
 * keeps the query simple and the sort deterministic. At 60 products
 * (the current page size) this is O(n log n) ≈ 350 ops — negligible.
 * Phase 20 hardening (P3.1 covering indexes) would denormalize
 * `min_price_cents` to the products table to enable SQL-side sort.
 */
export function sortByPrice(
  products: ProductListItem[],
  dir: 'asc' | 'desc',
): ProductListItem[] {
  // Stable sort: copy first, then sort by starting_price_cents,
  // treating nulls as Infinity (so null-priced products sink to
  // the bottom on asc and float to the top on desc — predictable
  // behavior, not undefined order).
  const copy = [...products]
  copy.sort((a, b) => {
    const av = a.starting_price_cents ?? Number.POSITIVE_INFINITY
    const bv = b.starting_price_cents ?? Number.POSITIVE_INFINITY
    return dir === 'asc' ? av - bv : bv - av
  })
  return copy
}

/** Page size for the catalog grid. Matches the previous `/browse` limit. */
export const BROWSE_PAGE_SIZE = 60

export function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return ''
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`
  if (hours > 0) return `${hours}h`
  return `${minutes}m`
}

export function formatLessonCount(n: number): string {
  if (n === 0) return ''
  if (n === 1) return '1 lesson'
  return `${n} lessons`
}

/**
 * Render a 0..5 rating as a five-glyph star row (★★★★☆).
 * Returns an empty string for nullish or zero ratings so callers can
 * `&&` the result without rendering an empty visual row.
 *
 * Glyphs are unicode "BLACK STAR" (U+2605) and "WHITE STAR"
 * (U+2606) — these render in the system font on every platform and
 * inherit `color: var(--star)` from the parent. The number is rounded
 * to the nearest half star; the .5 case shows a half-star glyph when
 * the parent requests it (U+2605 + U+2606 doesn't compose, so we use
 * one of two "all filled" / "n filled + remainder empty" states — the
 * design system renders whole-star granularity, see `mockups/home.html`
 * `.stars` which shows ★★★★☆ for 4.0 and ★★★★★ for 5.0).
 */
export function formatStarRow(rating: number | null | undefined): string {
  if (rating == null || rating <= 0) return ''
  // Clamp to 0..5 — defensive against bad data
  const clamped = Math.max(0, Math.min(5, rating))
  const full = Math.round(clamped)
  return '★'.repeat(full) + '☆'.repeat(5 - full)
}

/**
 * Compute the save percentage as a negative integer for the badge
 * (e.g. -85). Returns null when the inputs don't form a valid
 * discount (no compare-at, or compare-at ≤ price).
 *
 * The "save" is what the buyer saves: (msrp - price) / msrp, rounded
 * to an integer percent. Always a non-negative percentage; the
 * caller decides on the leading dash.
 */
export function formatSavePct(
  priceCents: number | null,
  msrpCents: number | null,
): number | null {
  if (priceCents == null || msrpCents == null) return null
  if (msrpCents <= priceCents) return null
  if (msrpCents <= 0) return null
  return Math.round(((msrpCents - priceCents) / msrpCents) * 100)
}
