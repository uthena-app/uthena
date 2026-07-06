// Admin payouts loading fallback. Renders while
// `app/admin/payouts/page.tsx` streams in (it awaits requireAdmin +
// getAdminLedger). Mirrors the payouts page shape — header + 4-KPI
// stats grid + "Top available balances" list + ledger entries table.
//
// No data fetch. No client JS. Pure RSC + the shared `Skeleton` primitive.

import { Skeleton } from '@foundations/ui/primitives/Skeleton'
import styles from './loading.module.css'

export default function AdminPayoutsLoading() {
  return (
    <main id="main" className={styles.page} aria-busy="true" aria-label="Loading…">
      <header className={styles.header} aria-hidden="true">
        <Skeleton width="30%" height={32} radius={8} ariaLabel="" />
        <Skeleton width="50%" height={14} radius={6} ariaLabel="" />
      </header>

      <section className={styles.stats} aria-hidden="true">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className={styles.statCard}>
            <Skeleton width={100} height={11} radius={6} ariaLabel="" />
            <Skeleton width="70%" height={24} radius={6} ariaLabel="" />
          </div>
        ))}
      </section>

      <section className={styles.byPartner} aria-hidden="true">
        <Skeleton width={200} height={12} radius={6} ariaLabel="" />
        <ul className={styles.list}>
          {Array.from({ length: 5 }, (_, i) => (
            <li key={i} className={styles.listRow}>
              <Skeleton width="40%" height={14} radius={6} ariaLabel="" />
              <Skeleton width={80} height={14} radius={6} ariaLabel="" />
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.ledgerSection} aria-hidden="true">
        <Skeleton width={180} height={12} radius={6} ariaLabel="" />
        <ul className={styles.entries}>
          {Array.from({ length: 6 }, (_, i) => (
            <li key={i} className={styles.entry}>
              <div className={styles.entryMain}>
                <Skeleton width={80} height={11} radius={6} ariaLabel="" />
                <Skeleton width="70%" height={12} radius={6} ariaLabel="" />
              </div>
              <Skeleton width={80} height={12} radius={6} ariaLabel="" />
              <Skeleton width={80} height={24} radius={999} ariaLabel="" />
              <Skeleton width={70} height={16} radius={6} ariaLabel="" />
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}
