// Library loading fallback. Renders while `app/library/page.tsx`
// streams in (it awaits requireUser() + two parallel queries). Mirrors
// the library shape — header + 2-column layout (sidebar nav on the
// left, content with grouped sections on the right).
//
// No data fetch. No client JS. Pure RSC + the shared `Skeleton` primitive.

import { Skeleton } from '@foundations/ui/primitives/Skeleton'
import styles from './loading.module.css'

export default function LibraryLoading() {
  return (
    <main id="main" className={styles.page} aria-busy="true" aria-label="Loading…">
      <header className={styles.header} aria-hidden="true">
        <Skeleton width="40%" height={32} radius={8} ariaLabel="" />
        <Skeleton width="50%" height={14} radius={6} ariaLabel="" />
      </header>

      <div className={styles.layout}>
        {/* Left rail: section nav */}
        <nav className={styles.nav} aria-hidden="true">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} width="80%" height={32} radius={6} ariaLabel="" />
          ))}
        </nav>

        {/* Right content: grouped sections */}
        <div className={styles.content}>
          {[0, 1].map((section) => (
            <section key={section} className={styles.section} aria-hidden="true">
              <Skeleton width={120} height={12} radius={6} ariaLabel="" />
              <Skeleton width="70%" height={12} radius={6} ariaLabel="" />
              <ul className={styles.list}>
                {Array.from({ length: 3 }, (_, i) => (
                  <li key={i} className={styles.row}>
                    <Skeleton width={80} height={60} radius={8} ariaLabel="" />
                    <div className={styles.rowBody}>
                      <Skeleton width="65%" height={16} radius={6} ariaLabel="" />
                      <Skeleton width="40%" height={12} radius={6} ariaLabel="" />
                    </div>
                    <Skeleton width={80} height={32} radius={6} ariaLabel="" />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </main>
  )
}
