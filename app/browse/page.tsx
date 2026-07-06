// Browse — full catalog grid. RSC. Reads from Supabase, filtered by
// `?category=`, `?sort=`, `?price=`, `?density=`. All filters are
// URL-driven; the URL is the source of truth, the page re-renders
// on every navigation. ISR-cached 60s per unique URL.

import type { Metadata } from 'next'
import Link from 'next/link'
import { getPublishedProducts, getActiveCategories } from '@features/catalog/queries'
import { ProductCard } from '@features/catalog/ProductCard'
import { BrowseSortSelect } from '@features/catalog/BrowseSortSelect'
import { getSubscriptionCatalogAccess } from '@features/library/queries/getSubscriptionCatalogAccess'
import { EmptyState } from '@foundations/ui/primitives/EmptyState'
import {
  DEFAULT_SORT,
  DEFAULT_DENSITY,
  DEFAULT_PRICE_BUCKET,
  PRICE_BUCKET_LABELS,
  parseSort,
  parsePriceBucket,
  parseDensity,
  type PriceBucket,
  type SortKey,
} from '@features/catalog/format'
import { buildPageMetadata } from '@foundations/metadata'
import { JsonLd, buildBreadcrumbSchema } from '@foundations/structured-data'
import styles from './browse.module.css'

// P0.21 — full OpenGraph + Twitter Card via the shared helper.
export const metadata: Metadata = buildPageMetadata({
  title: 'Browse all courses',
  description:
    'Browse every published course on Uthena. Filter by category, sort by newest, best selling, or price. PLR / MRR / RR licenses included.',
  path: '/browse',
})

export const revalidate = 60

type SearchParams = Promise<{
  category?: string
  sort?: string
  price?: string
  density?: string
}>

export default async function BrowsePage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams
  const activeCategory = sp.category
  const sort: SortKey = parseSort(sp.sort)
  const priceBucket: PriceBucket = parsePriceBucket(sp.price)
  const density = parseDensity(sp.density)

  // Build the canonical href that PRESERVES the non-overridden
  // params. Used for the category sidebar, density toggle, price
  // chips, and clear-all link. Strips the named param to "unset"
  // it, keeps everything else.
  const buildHref = (overrides: {
    category?: string | null
    sort?: SortKey | null
    price?: PriceBucket | null
    density?: typeof density | null
  }): string => {
    const params = new URLSearchParams()
    const cat = 'category' in overrides ? overrides.category : activeCategory
    const sr = 'sort' in overrides ? overrides.sort : sort
    const pr = 'price' in overrides ? overrides.price : priceBucket
    const dn = 'density' in overrides ? overrides.density : density
    if (cat) params.set('category', cat)
    if (sr && sr !== DEFAULT_SORT) params.set('sort', sr)
    if (pr && pr !== DEFAULT_PRICE_BUCKET) params.set('price', pr)
    if (dn && dn !== DEFAULT_DENSITY) params.set('density', dn)
    const qs = params.toString()
    return qs ? `/browse?${qs}` : '/browse'
  }

  const hasActiveFilter = priceBucket !== DEFAULT_PRICE_BUCKET || density !== DEFAULT_DENSITY

  const [products, categories, subscriptionAccess] = await Promise.all([
    getPublishedProducts({
      ...(activeCategory ? { category: activeCategory } : {}),
      sort,
      priceBucket,
    }),
    getActiveCategories(),
    getSubscriptionCatalogAccess(),
  ])

  const categoryName = activeCategory
    ? categories.find((c) => c.slug === activeCategory)?.name
    : undefined

  // P0.22 — JSON-LD BreadcrumbList. Only emit when a category
  // filter is active (the default /browse URL is the marketplace
  // root, no breadcrumb beyond "Home" is meaningful). When
  // filtered, the trail is Home > Browse > {category}.
  const breadcrumbSchema = activeCategory
    ? buildBreadcrumbSchema([
        { name: 'Home', path: '/' },
        { name: 'Browse', path: '/browse' },
        { name: categoryName ?? activeCategory, path: `/collections/${activeCategory}` },
      ])
    : null

  return (
    <>
      {breadcrumbSchema ? <JsonLd data={breadcrumbSchema} /> : null}
      <main id="main" className={styles.page}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Marketplace</p>
        <h1 className={styles.h1}>
          {categoryName ?? 'All '}
          {!categoryName ? <span className={styles.h1Accent}>courses</span> : null}
        </h1>
        <p className={styles.lede}>
          {products.length} {products.length === 1 ? 'course' : 'courses'}
          {activeCategory ? ' in this category' : ' across all categories'}
          {priceBucket !== DEFAULT_PRICE_BUCKET
            ? `, ${PRICE_BUCKET_LABELS[priceBucket].toLowerCase()}`
            : ''}
          .
        </p>

        {/* Active-filter chips row. Renders only when at least one
            filter is active, so the default `/browse` URL is clean.
            Each chip's ✕ links to the URL with that filter stripped
            (the others preserved). */}
        {hasActiveFilter ? (
          <div className={styles.filterChips} role="group" aria-label="Active filters">
            {priceBucket !== DEFAULT_PRICE_BUCKET ? (
              <Link
                href={buildHref({ price: DEFAULT_PRICE_BUCKET })}
                className={`${styles.chip} ${styles.chipOn}`}
                aria-label={`Remove price filter: ${PRICE_BUCKET_LABELS[priceBucket]}`}
              >
                Price: {PRICE_BUCKET_LABELS[priceBucket]} <span className={styles.chipX} aria-hidden>✕</span>
              </Link>
            ) : null}
            {density !== DEFAULT_DENSITY ? (
              <Link
                href={buildHref({ density: DEFAULT_DENSITY })}
                className={`${styles.chip} ${styles.chipOn}`}
                aria-label="Reset density to comfortable"
              >
                Density: Compact <span className={styles.chipX} aria-hidden>✕</span>
              </Link>
            ) : null}
            <Link
              href={buildHref({ price: DEFAULT_PRICE_BUCKET, density: DEFAULT_DENSITY })}
              className={styles.clearAll}
            >
              Clear all <span aria-hidden>✕</span>
            </Link>
          </div>
        ) : null}
      </header>

      <div className={styles.body}>
        <aside className={styles.sidebar} aria-label="Filters">
          <p className={styles.filterH}>Category</p>
          <ul className={styles.filterList}>
            <li>
              <Link
                href={buildHref({ category: null })}
                className={!activeCategory ? styles.filterActive : styles.filterLink}
              >
                All
              </Link>
            </li>
            {categories.map((c) => (
              <li key={c.slug}>
                <Link
                  href={buildHref({ category: c.slug })}
                  className={activeCategory === c.slug ? styles.filterActive : styles.filterLink}
                >
                  {c.name}
                  <span className={styles.filterCount}>{c.product_count}</span>
                </Link>
              </li>
            ))}
          </ul>

          {/* Price filter — visible inside the sidebar so it survives
              the chips row above (the chips disappear on the default
              URL; the sidebar shows all options on every URL). The
              active option gets the `.filterActive` treatment. */}
          <p className={styles.filterH}>Price</p>
          <ul className={styles.filterList}>
            {(['any', 'free', 'under-50', 'under-100'] as PriceBucket[]).map((b) => (
              <li key={b}>
                <Link
                  href={buildHref({
                    price: b === DEFAULT_PRICE_BUCKET ? null : b,
                  })}
                  className={priceBucket === b ? styles.filterActive : styles.filterLink}
                  aria-pressed={priceBucket === b}
                >
                  {PRICE_BUCKET_LABELS[b]}
                </Link>
              </li>
            ))}
          </ul>
        </aside>

        <section className={styles.gridWrap}>
          {/* Results head — count + sort dropdown + density toggle.
              All on one row, matching the mockup's `.results-head`
              shape. */}
          <div className={styles.resultsHead}>
            <p className={styles.count} aria-live="polite">
              {products.length} {products.length === 1 ? 'course' : 'courses'}
            </p>
            <div className={styles.controls}>
              <BrowseSortSelect current={sort} />
              <div className={styles.density} role="group" aria-label="Grid density">
                <Link
                  href={buildHref({ density: 'comfortable' })}
                  className={
                    density === 'comfortable' ? styles.densityOn : styles.densityLink
                  }
                  aria-pressed={density === 'comfortable'}
                  title="Comfortable density (3 columns)"
                >
                  Comfortable
                </Link>
                <Link
                  href={buildHref({ density: 'compact' })}
                  className={density === 'compact' ? styles.densityOn : styles.densityLink}
                  aria-pressed={density === 'compact'}
                  title="Compact density (4 columns)"
                >
                  Compact
                </Link>
              </div>
            </div>
          </div>

          {products.length === 0 ? (
            <EmptyState
              title="No courses match these filters."
              description="Try a different price range, or clear the filters to see everything."
              action={
                <Link
                  href={buildHref({ price: DEFAULT_PRICE_BUCKET, density: DEFAULT_DENSITY })}
                  className={styles.linkBtn}
                >
                  Clear filters
                </Link>
              }
            />
          ) : (
            <div
              className={`${styles.grid} ${
                density === 'compact' ? styles.gridCompact : styles.gridComfortable
              }`}
            >
              {products.map((p) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  subscriptionIncluded={subscriptionAccess.productIds.has(p.id)}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
    </>
  )
}
