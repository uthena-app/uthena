// /library/downloads loading fallback. Mirrors the page shape:
// header + filter strip + table skeleton. No data fetch. No client JS.
// Pure RSC + the shared Skeleton primitive.

import { Skeleton } from '@foundations/ui/primitives/Skeleton'
import styles from './loading.module.css'

export default function DownloadHistoryLoading() {
  return (
    <main id="main" className={styles.page} aria-busy="true" aria-label="Loading…">
      <header className={styles.header} aria-hidden="true">
        <Skeleton width="40%" height={32} radius={8} ariaLabel="" />
        <Skeleton width="60%" height={14} radius={6} ariaLabel="" />
      </header>

      {/* Filter strip skeleton — same shape as <DownloadHistoryFilters /> */}
      <Skeleton width="100%" height={70} radius={8} ariaLabel="" />

      {/* Summary line skeleton */}
      <Skeleton width="40%" height={14} radius={6} ariaLabel="" />

      {/* Table skeleton — single block so the Skeleton pulse isn't 50+
         tiny elements. The Skeleton primitive is aria-hidden; the page's
         aria-busy="true" + the aria-label on <main> announce loading to
         screen readers. */}
      <div className={styles.tableSkeleton} aria-hidden="true">
        <Skeleton width="100%" height={320} radius={8} ariaLabel="" />
      </div>
    </main>
  )
}
