// Account subscriptions loading fallback. Renders while
// `app/account/subscriptions/page.tsx` streams in (it awaits
// getSessionUser + 2 parallel queries + env check). Mirrors the
// subscriptions surface — header + 2-col (status card on left, recent
// invoices list on right).
//
// No data fetch. No client JS. Pure RSC + the shared `Skeleton` primitive.

import { Skeleton } from '@foundations/ui/primitives/Skeleton'
import styles from './loading.module.css'

export default function AccountSubscriptionsLoading() {
  return (
    <main id="main" className={styles.page} aria-busy="true" aria-label="Loading…">
      <header className={styles.header} aria-hidden="true">
        <Skeleton width="30%" height={32} radius={8} ariaLabel="" />
        <Skeleton width="40%" height={14} radius={6} ariaLabel="" />
      </header>

      <div className={styles.layout} aria-hidden="true">
        <section className={styles.statusCard}>
          <Skeleton width={140} height={12} radius={6} ariaLabel="" />
          <Skeleton width="60%" height={28} radius={6} ariaLabel="" />
          <Skeleton count={2} ariaLabel="" />
          <Skeleton width={140} height={44} radius={999} ariaLabel="" />
        </section>

        <section className={styles.invoicesCard}>
          <Skeleton width={140} height={12} radius={6} ariaLabel="" />
          <ul className={styles.invoiceList}>
            {Array.from({ length: 4 }, (_, i) => (
              <li key={i} className={styles.invoiceRow}>
                <div className={styles.rowBody}>
                  <Skeleton width="60%" height={14} radius={6} ariaLabel="" />
                  <Skeleton width="40%" height={11} radius={6} ariaLabel="" />
                </div>
                <Skeleton width={70} height={14} radius={6} ariaLabel="" />
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  )
}
