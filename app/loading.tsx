// Root loading fallback. Renders for any route that doesn't ship its
// own `loading.tsx` (auth, partner, admin, library, legal pages, etc.).
// Mirrors the most common shape — eyebrow + h1 + lede + 6-card grid +
// band — so the streaming skeleton feels close to the eventual page
// regardless of which route is being loaded.
//
// No data fetch. No client JS. Pure RSC + the shared `Skeleton`
// primitive + a token-only CSS module.

import { Skeleton } from '@foundations/ui/primitives/Skeleton'
import styles from './loading.module.css'

export default function RootLoading() {
  return (
    <main id="main" className={styles.page} aria-busy="true" aria-label="Loading…">
      <header className={styles.header}>
        <Skeleton width={120} height={12} radius={6} ariaLabel="" />
        <Skeleton width="60%" height={40} radius={8} ariaLabel="" />
        <Skeleton count={2} ariaLabel="" />
      </header>

      <section className={styles.grid} aria-hidden="true">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className={styles.card}>
            <Skeleton variant="card" ariaLabel="" />
          </div>
        ))}
      </section>

      <section className={styles.band} aria-hidden="true">
        <Skeleton width="40%" height={24} radius={6} ariaLabel="" />
        <Skeleton count={3} ariaLabel="" />
        <Skeleton width={180} height={44} radius={999} ariaLabel="" />
      </section>
    </main>
  )
}