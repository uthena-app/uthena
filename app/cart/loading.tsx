// Cart loading fallback. Renders while `app/cart/page.tsx` streams in
// (it awaits getSessionUser() + cart queries + product license lookup).
// Mirrors the cart shape — header + 2-col (line items on the left,
// summary card on the right).
//
// No data fetch. No client JS. Pure RSC + the shared `Skeleton` primitive.

import { Skeleton } from '@foundations/ui/primitives/Skeleton'
import styles from './loading.module.css'

export default function CartLoading() {
  return (
    <main id="main" className={styles.page} aria-busy="true" aria-label="Loading…">
      <header className={styles.header} aria-hidden="true">
        <div className={styles.headerLeft}>
          <Skeleton width={120} height={32} radius={8} ariaLabel="" />
          <Skeleton width={60} height={14} radius={6} ariaLabel="" />
        </div>
      </header>

      <div className={styles.layout}>
        <section className={styles.lines} aria-hidden="true">
          <ul className={styles.list}>
            {Array.from({ length: 3 }, (_, i) => (
              <li key={i} className={styles.line}>
                <Skeleton width={96} height={64} radius={8} ariaLabel="" />
                <div className={styles.lineBody}>
                  <Skeleton width="70%" height={18} radius={6} ariaLabel="" />
                  <Skeleton width="40%" height={12} radius={6} ariaLabel="" />
                </div>
                <div className={styles.lineActions}>
                  <Skeleton width={120} height={32} radius={6} ariaLabel="" />
                  <Skeleton width={60} height={32} radius={6} ariaLabel="" />
                </div>
              </li>
            ))}
          </ul>
        </section>

        <aside className={styles.summary} aria-label="Order summary loading">
          <Skeleton width="60%" height={14} radius={6} ariaLabel="" />
          <div className={styles.summaryRows}>
            <Skeleton width="100%" height={14} radius={6} ariaLabel="" />
            <Skeleton width="100%" height={14} radius={6} ariaLabel="" />
            <Skeleton width="100%" height={18} radius={6} ariaLabel="" />
          </div>
          <Skeleton height={48} radius={999} ariaLabel="" />
          <Skeleton width="80%" height={12} radius={6} ariaLabel="" />
        </aside>
      </div>
    </main>
  )
}
