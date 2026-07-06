// FeaturedSection — the home page's "Ready-to-use online courses"
// section. Renders the live ProductCard grid; falls back to the
// shared EmptyState when the catalog is empty (so the section's
// visual rhythm is preserved on a fresh database).
//
// "Featured" in the spec = getFeaturedProducts (catalog/queries).
// P0.10 doesn't add a separate flag/curation; the catalog query
// already returns the most recently published products.

import Link from 'next/link'
import { ProductCard } from '@features/catalog/ProductCard'
import { EmptyState } from '@foundations/ui/primitives/EmptyState'
import type { ProductListItem } from '@features/catalog/queries'
import styles from './FeaturedSection.module.css'

type Props = {
  products: ProductListItem[]
  totalCount: number
  /**
   * Set of product ids the current user accesses via their active
   * Personal Access subscription (P8.2). Passed through to
   * `<ProductCard subscriptionIncluded={...}>` so the home grid
   * shows the "Included with Personal Access" badge on the
   * matching cards. Anon callers pass an empty Set (default).
   */
  subscriptionProductIds?: Set<number>
}

export function FeaturedSection({
  products,
  totalCount,
  subscriptionProductIds = new Set(),
}: Props) {
  return (
    <section className={`${styles.sec} ${styles.tintBase}`} aria-labelledby="featured-h">
      <div className={styles.secHead}>
        <div>
          <div className={styles.eyebrow}>Featured</div>
          <h2 id="featured-h" className={styles.h2}>
            Ready-to-use <span className={styles.teal}>online courses</span>
          </h2>
        </div>
        <div className={styles.right}>
          <Link href="/browse" className={styles.viewAll}>
            View all {totalCount} →
          </Link>
        </div>
      </div>
      {products.length === 0 ? (
        <EmptyState
          title="The catalog is still warming up."
          description="Once partners publish courses, they'll appear here. Check back soon."
        />
      ) : (
        <div className={styles.grid}>
          {products.slice(0, 6).map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              subscriptionIncluded={subscriptionProductIds.has(p.id)}
            />
          ))}
        </div>
      )}
    </section>
  )
}
