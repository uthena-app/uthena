// Admin categories loading fallback. Renders while
// `app/admin/categories/page.tsx` streams in (it awaits requireRole +
// 3 parallel queries: getCategoryTree, getCategoryStats,
// getCategoryHistory). Mirrors the categories page shape — admin
// shell wraps content with 3 stacked panels (stats cards, categories
// tree, history panel).
//
// No data fetch. No client JS. Pure RSC + the shared `Skeleton` primitive.

import { Skeleton } from '@foundations/ui/primitives/Skeleton'
import styles from './loading.module.css'

export default function AdminCategoriesLoading() {
  return (
    <main id="main" className={styles.page} aria-busy="true" aria-label="Loading…">
      <div className={styles.stats} aria-hidden="true">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className={styles.statCard}>
            <Skeleton width={80} height={11} radius={6} ariaLabel="" />
            <Skeleton width="60%" height={24} radius={6} ariaLabel="" />
          </div>
        ))}
      </div>

      <section className={styles.section} aria-hidden="true">
        <div className={styles.sectionHeader}>
          <Skeleton width={120} height={14} radius={6} ariaLabel="" />
          <Skeleton width={140} height={32} radius={6} ariaLabel="" />
        </div>
        <div className={styles.tree}>
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className={styles.treeRow} style={{ paddingLeft: `${(i % 3) * 24 + 12}px` }}>
              <Skeleton width={16} height={16} radius={4} ariaLabel="" />
              <Skeleton width={`${50 + (i % 4) * 10}%`} height={14} radius={6} ariaLabel="" />
              <Skeleton width={60} height={20} radius={999} ariaLabel="" />
            </div>
          ))}
        </div>
      </section>

      <section className={styles.section} aria-hidden="true">
        <Skeleton width={140} height={14} radius={6} ariaLabel="" />
        <ul className={styles.history}>
          {Array.from({ length: 6 }, (_, i) => (
            <li key={i} className={styles.historyRow}>
              <Skeleton width={100} height={11} radius={6} ariaLabel="" />
              <Skeleton width="60%" height={12} radius={6} ariaLabel="" />
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}
