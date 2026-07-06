// CategoriesSection — the home page's "Browse by category" grid.
// Renders one card per active category from getActiveCategories().
// Each card is an icon (initials), name, count, and "Browse →" link
// to `/browse?category=<slug>` (matches the existing browse URL
// convention). When no categories exist, the shared EmptyState
// renders so the section keeps its shape.

import Link from 'next/link'
import { EmptyState } from '@foundations/ui/primitives/EmptyState'
import styles from './CategoriesSection.module.css'

type Category = { slug: string; name: string; product_count: number }

type Props = {
  categories: Category[]
}

function initials(name: string): string {
  // Pick up to two leading letters, uppercase. "AI" stays "AI",
  // "Mental Health" becomes "MH", "Programming" becomes "PR".
  const cleaned = name.replace(/[^A-Za-z\s]/g, '').trim()
  if (!cleaned) return '··'
  const parts = cleaned.split(/\s+/).filter(Boolean)
  if (parts.length === 1) {
    return parts[0]!.slice(0, 2).toUpperCase()
  }
  return ((parts[0]![0] ?? '') + (parts[1]![0] ?? '')).toUpperCase()
}

export function CategoriesSection({ categories }: Props) {
  return (
    <section className={styles.sec} aria-labelledby="categories-h">
      <div className={styles.secHead}>
        <div>
          <div className={styles.eyebrow}>Browse by category</div>
          <h2 id="categories-h" className={styles.h2}>
            Find your niche
          </h2>
        </div>
        <div className={styles.right}>
          <Link href="/browse" className={styles.viewAll}>
            All categories →
          </Link>
        </div>
      </div>
      {categories.length === 0 ? (
        <EmptyState
          title="No categories yet."
          description="Once partners publish courses, categories will appear here."
        />
      ) : (
        <div className={styles.grid}>
          {categories.slice(0, 8).map((cat) => (
            <Link
              key={cat.slug}
              href={`/browse?category=${cat.slug}`}
              className={styles.cat}
            >
              <div className={styles.icn} aria-hidden="true">
                {initials(cat.name)}
              </div>
              <div className={styles.meta}>
                <div className={styles.nm}>{cat.name}</div>
                <div className={styles.ct}>{cat.product_count} courses</div>
              </div>
              <div className={styles.more}>Browse →</div>
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}
