// Bundles loading fallback. Renders while `app/bundles/page.tsx` streams
// in. Mirrors the bundles page: eyebrow + h1 + lede + count + 6-card
// grid + tail CTA skeleton.
//
// No data fetch. No client JS. Pure RSC + the shared `Skeleton` primitive.

import { Skeleton } from '@foundations/ui/primitives/Skeleton'
import styles from './loading.module.css'

export default function BundlesLoading() {
  return (
    <main id="main" className={styles.page} aria-busy="true" aria-label="Loading…">
      <header className={styles.header}>
        <Skeleton width={80} height={12} radius={6} ariaLabel="" />
        <Skeleton width="50%" height={36} radius={8} ariaLabel="" />
        <Skeleton count={2} ariaLabel="" />
        <Skeleton width={120} height={12} radius={6} ariaLabel="" />
      </header>

      <div className={styles.grid} aria-hidden="true">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} variant="card" ariaLabel="" />
        ))}
      </div>

      <Skeleton width={240} height={16} radius={4} ariaLabel="" />
    </main>
  )
}