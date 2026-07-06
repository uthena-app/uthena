// Search loading fallback. Renders while `app/search/page.tsx` streams
// in. Mirrors the search page: header + results head + 6-card grid +
// tail CTA.
//
// No data fetch. No client JS. Pure RSC + the shared `Skeleton` primitive.

import { Skeleton } from '@foundations/ui/primitives/Skeleton'
import styles from './loading.module.css'

export default function SearchLoading() {
  return (
    <main id="main" className={styles.page} aria-busy="true" aria-label="Loading…">
      <header className={styles.header}>
        <Skeleton width={80} height={12} radius={6} ariaLabel="" />
        <Skeleton width="55%" height={36} radius={8} ariaLabel="" />
        <Skeleton count={2} ariaLabel="" />
        <div className={styles.filterChips} aria-hidden="true">
          <Skeleton width={140} height={28} radius={999} ariaLabel="" />
        </div>
      </header>

      <div className={styles.resultsHead}>
        <Skeleton width={100} height={12} radius={6} ariaLabel="" />
      </div>

      <div className={styles.grid} aria-hidden="true">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} variant="card" ariaLabel="" />
        ))}
      </div>

      <Skeleton width={280} height={16} radius={4} ariaLabel="" />
    </main>
  )
}