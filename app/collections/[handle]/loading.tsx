// Collections detail loading fallback. Renders while
// `app/collections/[handle]/page.tsx` streams in. Mirrors the detail
// page: header + 6-card grid.
//
// No data fetch. No client JS. Pure RSC + the shared `Skeleton` primitive.

import { Skeleton } from '@foundations/ui/primitives/Skeleton'
import styles from './loading.module.css'

export default function CollectionDetailLoading() {
  return (
    <main id="main" className={styles.page} aria-busy="true" aria-label="Loading…">
      <header className={styles.header}>
        <Skeleton width={100} height={12} radius={6} ariaLabel="" />
        <Skeleton width="50%" height={36} radius={8} ariaLabel="" />
        <Skeleton count={2} ariaLabel="" />
      </header>

      <div className={styles.grid} aria-hidden="true">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} variant="card" ariaLabel="" />
        ))}
      </div>
    </main>
  )
}