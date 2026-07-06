// Bundles listing — `/bundles`. P0.18.
//
// Replaces the previous placeholder. The page renders one card per
// published bundle (`products.kind = 'bundle'` AND `status = 'published'`)
// with an "N courses" meta row + 3-thumb preview strip. The page is
// pure RSC, public, ISR-cached 60s (matches the rest of the catalog
// family — /browse is 60s, /collections/[handle] is 60s, /products/[slug]
// is 0 with revalidate=60 on the catalog grid pages).
//
// Why a dedicated /bundles page (instead of /browse?kind=bundle):
//   - Bundle cards have a different shape (included-courses preview
//     strip, "Bundle" pill) that would be a misfit in the standard
//     product grid.
//   - Bundles deserve a curated landing — a real storefront for the
//     "Buy the whole set" customer journey. /browse?kind=bundle would
//     bury them in the catalog's price/sort/density machinery.
//   - The mockup's Bundles nav item is a top-level destination, not
//     a filter.
//
// The included-product preview comes from the `bundle_items` join
// table (migration 0016). RLS (`bundle_items_public_read_published`)
// guarantees the preview is empty for any bundle whose included
// products aren't all published — the card still renders, but
// without the preview strip.

import type { Metadata } from 'next'
import { getPublishedBundles } from '@features/catalog/queries'
import { BundleCard } from '@features/catalog/BundleCard'
import { getSubscriptionCatalogAccess } from '@features/library/queries/getSubscriptionCatalogAccess'
import { EmptyState } from '@foundations/ui/primitives/EmptyState'
import { buildPageMetadata } from '@foundations/metadata'
import { JsonLd, buildBreadcrumbSchema } from '@foundations/structured-data'
import styles from './bundles.module.css'

export const revalidate = 60

// P0.21 — full OpenGraph + Twitter Card via the shared helper.
// The helper handles canonical URL via `alternates.canonical`.
export const metadata: Metadata = buildPageMetadata({
  title: 'Bundles — curated course sets at a discount',
  description:
    'Save more when you buy a curated set. Pick a theme — AI, marketing, business — and get every course in full PLR or MRR for one price.',
  path: '/bundles',
})

export default async function BundlesPage() {
  const [bundles, subscriptionAccess] = await Promise.all([
    getPublishedBundles(),
    getSubscriptionCatalogAccess(),
  ])
  const totalCount = bundles.length

  return (
    <>
      {/* P0.22 — JSON-LD BreadcrumbList (Home > Bundles). */}
      <JsonLd
        data={buildBreadcrumbSchema([
          { name: 'Home', path: '/' },
          { name: 'Bundles', path: '/bundles' },
        ])}
      />
      <main id="main" className={styles.page}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Bundles</p>
        <h1 className={styles.h1}>
          Curated <span className={styles.h1Accent}>course bundles</span>
        </h1>
        <p className={styles.lede}>
          Pick a theme — AI, marketing, business — and save when you buy the
          whole set. Every course in a bundle is full PLR.
        </p>
        {totalCount > 0 && (
          <p className={styles.count} aria-live="polite">
            {totalCount} {totalCount === 1 ? 'bundle' : 'bundles'} live
          </p>
        )}
      </header>

      {totalCount === 0 ? (
        <EmptyState
          title="No bundles live yet."
          description="We're curating the first set. In the meantime, browse the full catalog — every course is available individually with the same PLR rights."
          action={
            <a href="/browse" className={styles.linkBtn}>
              Browse the catalog
            </a>
          }
        />
      ) : (
        <div className={styles.grid}>
          {bundles.map((b) => (
            <BundleCard
              key={b.id}
              bundle={b}
              subscriptionIncluded={subscriptionAccess.productIds.has(b.id)}
            />
          ))}
        </div>
      )}

      {/* Secondary CTA — the mockup's footer pattern: a quiet link to
          the full catalog for buyers who want the "build your own
          bundle" journey. /browse is the canonical entry to the
          unfiltered catalog. The phrase "or pick individual courses"
          mirrors the value-prop shape ("save when you buy the whole
          set" — the alternative is the cart without the bundle
          discount). */}
      {totalCount > 0 && (
        <p className={styles.tailCta}>
          Looking for a single course?{' '}
          <a href="/browse" className={styles.tailLink}>
            Browse the full catalog →
          </a>
        </p>
      )}
    </main>
    </>
  )
}
