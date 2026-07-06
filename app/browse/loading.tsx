// Browse loading fallback. Renders while `app/browse/page.tsx` streams in.
// Mirrors the browse page: header + filter chips + sidebar + results head
// + 12-card grid. Same shape as the eventual page so the streaming
// transition is smooth.
//
// No data fetch. No client JS. Pure RSC + the shared `Skeleton` primitive.

import { Skeleton } from '@foundations/ui/primitives/Skeleton'
import styles from './loading.module.css'

export default function BrowseLoading() {
  return (
    <main id="main" className={styles.page} aria-busy="true" aria-label="Loading…">
      <header className={styles.header}>
        <Skeleton width={120} height={12} radius={6} ariaLabel="" />
        <Skeleton width="40%" height={36} radius={8} ariaLabel="" />
        <Skeleton count={2} ariaLabel="" />
      </header>

      {/* Filter chips row */}
      <div className={styles.filterChips} aria-hidden="true">
        <Skeleton width={110} height={28} radius={999} ariaLabel="" />
        <Skeleton width={130} height={28} radius={999} ariaLabel="" />
      </div>

      <div className={styles.body}>
        {/* Sidebar */}
        <aside className={styles.sidebar} aria-label="Filters loading">
          <div className={styles.filterGroup}>
            <Skeleton width={90} height={12} radius={6} ariaLabel="" />
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} width="80%" height={16} radius={4} ariaLabel="" />
            ))}
          </div>
          <div className={styles.filterGroup}>
            <Skeleton width={70} height={12} radius={6} ariaLabel="" />
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} width="80%" height={16} radius={4} ariaLabel="" />
            ))}
          </div>
        </aside>

        <div className={styles.gridWrap}>
          {/* Results head */}
          <div className={styles.resultsHead}>
            <Skeleton width={100} height={12} radius={6} ariaLabel="" />
            <div className={styles.controls}>
              <Skeleton width={140} height={36} radius={8} ariaLabel="" />
              <Skeleton width={160} height={36} radius={999} ariaLabel="" />
            </div>
          </div>

          {/* Grid */}
          <div className={styles.grid}>
            {Array.from({ length: 12 }, (_, i) => (
              <Skeleton key={i} variant="card" ariaLabel="" />
            ))}
          </div>
        </div>
      </div>
    </main>
  )
}