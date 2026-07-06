// buildProductSchema — per-product Product JSON-LD.
//
// Renders a `Product` entity that Google's Product rich results
// consume: name, description, image, brand, offers (price +
// currency + availability + URL), and (when reviews exist)
// aggregateRating.
//
// The builder accepts the minimum data the product detail page
// has access to (after `getProductBySlug` returns). It derives
// the offer from the default pricing tier (mirrors the
// `defaultTier` picker in the page); if no active tier exists,
// `offers.availability` is `OutOfStock`.
//
// `aggregateRating` is OMITTED (not emitted as zeros) when the
// product has zero published reviews — Google's guidelines
// explicitly warn against emitting a rating with no reviews
// (misleading rich result + search-rank penalty).
//
// `sku` is synthesized as `<LICENSE>-<id>` (e.g. `PLR-1284`)
// because `products.sku` doesn't exist yet (P12.7 lands it via
// the partner wizard). The synthesized value matches the
// on-page "ID #PLR-1284" badge from P0.12 Slice 1, so the
// SERP and the page show the same code.

import { SITE_NAME, SITE_ORIGIN } from '@foundations/metadata'
import type { LicenseTier, ProductDetail, ProductListItem } from '@features/catalog/queries'

/** Schema.org URL constants — Google's Product rich-result docs
 *  use these exact strings. */
const SCHEMA_IN_STOCK = 'https://schema.org/InStock'
const SCHEMA_OUT_OF_STOCK = 'https://schema.org/OutOfStock'
const SCHEMA_CONTEXT = 'https://schema.org'

/** The minimum product shape the builder needs. We accept a
 *  structural subset (rather than the full `ProductDetail`) so
 *  the builder can also serve the catalog card's data if a
 *  future surface needs a Product schema without the full
 *  detail payload. Both `ProductListItem` and `ProductDetail`
 *  satisfy this shape. */
export type ProductSchemaInput = {
  id: number
  title: string
  short_description: string | null
  thumbnail_url: string | null
  category?: { name: string } | null
  default_license: LicenseTier | null
  /** The pricing tiers to derive `offers` from. The builder
   *  picks the same default the page picks (the active tier
   *  with `is_default: true`, falling back to the first
   *  active tier). */
  pricing: Array<{
    license: LicenseTier
    price_cents: number
    compare_at_cents: number | null
    is_default: boolean
    is_active: boolean
  }>
  /** Aggregate rating inputs. Pass `review_count: 0` to omit
   *  the rating block entirely (Google guideline). */
  avg_rating: number | null
  review_count: number | null
  /** The product slug. Used for `offers.url` (the canonical
   *  product URL). */
  slug: string
}

export type ProductSchema = {
  '@context': 'https://schema.org'
  '@type': 'Product'
  name: string
  description: string
  /** Optional — omitted entirely (not set to null) when the
   *  product has no thumbnail. Schema.org accepts both the
   *  string and the omitted form. */
  image?: string
  sku: string
  brand: { '@type': 'Brand'; name: string }
  category?: string
  offers: {
    '@type': 'Offer'
    price: string
    priceCurrency: 'USD'
    availability: 'https://schema.org/InStock' | 'https://schema.org/OutOfStock'
    url: string
  }
  /** Optional — omitted entirely when `review_count` is 0 (Google
   *  guideline: never emit a rating with no reviews). */
  aggregateRating?: {
    '@type': 'AggregateRating'
    ratingValue: number
    reviewCount: number
    bestRating: 5
    worstRating: 1
  }
}

/** Build the `Product` JSON-LD object. Pass either a
 *  `ProductDetail` (from the product detail page's
 *  `getProductBySlug`) or a `ProductListItem` enriched with the
 *  minimum `pricing` array (any future catalog-card surface).
 *
 *  The builder is tolerant of partial inputs: missing
 *  `short_description`, missing `thumbnail_url`, or zero
 *  reviews all render to a valid schema (with the relevant
 *  fields omitted or `OutOfStock` set). Throws only when the
 *  caller passes the wrong shape (e.g. pricing array missing). */
export function buildProductSchema(product: ProductSchemaInput): ProductSchema {
  const productUrl = `${SITE_ORIGIN}/products/${product.slug}`

  // Pick the same default tier the product detail page picks:
  // the active tier flagged `is_default`, falling back to the
  // first active tier. Mirrors `getProductBySlug` + the page's
  // `activePricing.find(p => p.is_default) ?? activePricing[0]`.
  const activeTiers = (product.pricing ?? []).filter((p) => p.is_active)
  const defaultTier = activeTiers.find((p) => p.is_default) ?? activeTiers[0] ?? null

  // SKU format: `<LICENSE>-<id>` (e.g. `PLR-1284`). When the
  // product has no default license, fall back to `PROD-<id>`.
  // Uppercase the license for consistency with the on-page ID
  // badge from P0.12 Slice 1.
  const sku = `${(product.default_license ?? 'PROD').toString().toUpperCase()}-${product.id}`

  const offers: ProductSchema['offers'] = defaultTier
    ? {
        '@type': 'Offer',
        // Schema.org `price` is a string-formatted decimal.
        // Our canonical unit is cents (bigint); convert here
        // to a USD string (e.g. `57.00` for 5700 cents).
        price: (defaultTier.price_cents / 100).toFixed(2),
        // The app currently supports USD only at the storefront
        // (EUR / GBP are typed in the schema but not yet wired
        // for live transactions). When multi-currency lands,
        // derive `priceCurrency` from the tier row.
        priceCurrency: 'USD',
        availability: SCHEMA_IN_STOCK,
        url: productUrl,
      }
    : {
        '@type': 'Offer',
        // No active pricing → no price. Schema.org requires
        // the price field as a string when `availability` is
        // `OutOfStock`; we set `'0.00'` defensively. Google
        // treats the product as out-of-stock when there's no
        // offer URL with a `Buy` button, but emitting the field
        // keeps the schema valid for the Rich Results Test.
        price: '0.00',
        priceCurrency: 'USD',
        availability: SCHEMA_OUT_OF_STOCK,
        url: productUrl,
      }

  const schema: ProductSchema = {
    '@context': SCHEMA_CONTEXT,
    '@type': 'Product',
    name: product.title,
    // `short_description` is the page's meta description and
    // the OG description. When null, fall back to an empty
    // string (Google accepts empty descriptions; the schema
    // must still be valid).
    description: product.short_description ?? '',
    // OG image field — absolute URL. Schema.org `image` accepts
    // an array but the single-image form is the simplest valid
    // shape. When null, we omit the field entirely (Google
    // recommends omitting rather than emitting a broken URL).
    ...(product.thumbnail_url
      ? { image: `${SITE_ORIGIN}${product.thumbnail_url.startsWith('/') ? '' : '/'}${product.thumbnail_url}` }
      : {}),
    sku,
    brand: {
      '@type': 'Brand',
      name: SITE_NAME,
    },
    ...(product.category?.name ? { category: product.category.name } : {}),
    offers,
  }

  // Aggregate rating — OMITTED when review_count is 0 (Google
  // guideline: never emit a rating with zero reviews). The
  // threshold is `review_count >= 1` AND a non-null `avg_rating`
  // (a product with reviews but no avg could exist in the data
  // shape; we don't want to emit a rating without a value).
  const reviewCount = product.review_count ?? 0
  if (reviewCount > 0 && product.avg_rating != null) {
    schema.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: product.avg_rating,
      reviewCount,
      // Uthena's rating scale is 1..5 (matches the existing
      // ProductCard stars + P0.7 `formatStarRow`). Hardcoded
      // here — if a future feature adds 10-star ratings, lift
      // these to a config constant.
      bestRating: 5,
      worstRating: 1,
    }
  }

  return schema
}

/** Re-export the structural input type so consumers can import
 *  it without reaching into the catalog module. */
export type { ProductListItem, ProductDetail }