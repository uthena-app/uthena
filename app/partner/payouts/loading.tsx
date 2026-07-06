// Partner payouts loading fallback. Renders while
// `app/partner/payouts/page.tsx` streams in (it awaits requirePartner
// + getPartnerLedger). Mirrors the payouts page shape — header +
// 3-KPI summary grid + ledger list.
//
// No data fetch. No client JS. Pure RSC + the shared `Skeleton` primitive.

import { Skeleton } from '@foundations/ui/primitives/Skeleton'
import styles from './loading.module.css'

export default function PartnerPayoutsLoading() {
  return (
    <main id="main" className={styles.page} aria-busy="true" aria-label="Loading…">
      <header className={styles.header} aria-hidden="true">
        <Skeleton width="30%" height={32} radius={8} ariaLabel="" />
        <Skeleton width="50%" height={14} radius={6} ariaLabel="" />
      </header>

      <section className={styles.summary} aria-hidden="true">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className={styles.statCard}>
            <Skeleton width={80} height={11} radius={6} ariaLabel="" />
            <Skeleton width="65%" height={24} radius={6} ariaLabel="" />
          </div>
        ))}
      </section>

      <section className={styles.ledger}>
        <div className={styles.ledgerHead}>
          <Skeleton width={180} height={12} radius={6} ariaLabel="" />
          <Skeleton width="60%" height={12} radius={6} ariaLabel="" />
        </div>
        <ul className={styles.entries} aria-hidden="true">
          {Array.from({ length: 5 }, (_, i) => (
            <li key={i} className={styles.entry}>
              <Skeleton width="60%" height={14} radius={6} ariaLabel="" />
              <Skeleton width={100} height={12} radius={6} ariaLabel="" />
              <Skeleton width={80} height={24} radius={999} ariaLabel="" />
              <Skeleton width={80} height={16} radius={6} ariaLabel="" />
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}
