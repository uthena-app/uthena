// Collections index — `/collections`. P0.17.
//
// Surfaces two distinct lists, in priority order:
//   1. Featured collections — team-curated, hand-picked groupings of
//      products (P0.17 new). Sorted featured-first then by
//      display_order.
//   2. All categories — the existing taxonomy, kept on the index
//      page so the SEO surface for `/collections` stays broad and
//      useful even before the admin has published any collections.
//
// Both lists fall through to the existing `EmptyState` primitive when
// empty (the page never ships a "0 results" placeholder).

import type { Metadata } from 'next'
import Link from 'next/link'
import { getActiveCategories, getPublishedCollections } from '@features/catalog/queries'
import { EmptyState } from '@foundations/ui/primitives/EmptyState'
import { buildPageMetadata } from '@foundations/metadata'
import styles from './collections.module.css'

// P0.21 — full OpenGraph + Twitter Card via the shared helper.
export const metadata: Metadata = buildPageMetadata({
  title: 'Collections',
  description:
    'Browse Uthena collections and categories — curated course bundles and the full taxonomy.',
  path: '/collections',
})

export const revalidate = 60

export default async function CollectionsIndexPage() {
  const [collections, categories] = await Promise.all([
    getPublishedCollections(),
    getActiveCategories(),
  ])

  return (
    <main id="main" className={styles.page}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Collections</p>
        <h1 className={styles.h1}>Browse by collection</h1>
        <p className={styles.lede}>
          Hand-picked course bundles curated by Uthena, plus the full category catalog.
        </p>
      </header>

      {/* Featured collections — the P0.17 surface. Hidden when no
          collections are published so the page degrades gracefully
          until the admin publishes the first one. */}
      {collections.length > 0 ? (
        <section className={styles.section} aria-labelledby="collections-featured-h">
          <h2 id="collections-featured-h" className={styles.sectionH}>
            Featured collections
          </h2>
          <ul className={styles.grid}>
            {collections.map((c) => (
              <li key={c.id}>
                <Link href={`/collections/${c.slug}`} className={styles.card}>
                  <p className={styles.cardEyebrow}>
                    {c.is_featured ? 'Featured' : 'Collection'}
                  </p>
                  <p className={styles.cardName}>{c.name}</p>
                  {c.description ? (
                    <p className={styles.cardDesc}>{c.description}</p>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Categories — the broad taxonomy. Always rendered when at
          least one category has products; falls through to the shared
          EmptyState when none do. */}
      <section className={styles.section} aria-labelledby="collections-categories-h">
        <h2 id="collections-categories-h" className={styles.sectionH}>
          All categories
        </h2>
        {categories.length === 0 ? (
          <EmptyState
            title="No categories yet."
            description="Categories will appear here once partners publish courses."
          />
        ) : (
          <ul className={styles.grid}>
            {categories.map((c) => (
              <li key={c.slug}>
                <Link href={`/collections/${c.slug}`} className={styles.card}>
                  <p className={styles.cardName}>{c.name}</p>
                  <p className={styles.cardCount}>
                    {c.product_count} {c.product_count === 1 ? 'course' : 'courses'}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
