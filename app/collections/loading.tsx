// Collections index loading fallback. Renders while
// `app/collections/page.tsx` streams in. Mirrors the index: header +
// featured collections row + categories row.
//
// No data fetch. No client JS. Pure RSC + the shared `Skeleton` primitive.

import { Skeleton } from '@foundations/ui/primitives/Skeleton'
import styles from './loading.module.css'

export default function CollectionsIndexLoading() {
  return (
    <main id="main" className={styles.page} aria-busy="true" aria-label="Loading…">
      <header className={styles.header}>
        <Skeleton width={120} height={12} radius={6} ariaLabel="" />
        <Skeleton width="40%" height={36} radius={8} ariaLabel="" />
        <Skeleton count={2} ariaLabel="" />
      </header>

      {/* Featured collections section */}
      <section className={styles.section} aria-hidden="true">
        <Skeleton width={180} height={20} radius={6} ariaLabel="" />
        <div className={styles.grid}>
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className={styles.card}>
              <Skeleton width={80} height={10} radius={4} ariaLabel="" />
              <Skeleton width="70%" height={20} radius={6} ariaLabel="" />
              <Skeleton count={2} ariaLabel="" />
            </div>
          ))}
        </div>
      </section>

      {/* All categories section */}
      <section className={styles.section} aria-hidden="true">
        <Skeleton width={140} height={20} radius={6} ariaLabel="" />
        <div className={styles.grid}>
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className={styles.card}>
              <Skeleton width="60%" height={18} radius={6} ariaLabel="" />
              <Skeleton width={60} height={12} radius={6} ariaLabel="" />
            </div>
          ))}
        </div>
      </section>
    </main>
  )
}