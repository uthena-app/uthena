// /admin/payouts/partner/[id] loading fallback. Mirrors the page
// shape: crumb + hero (display name + status pill) + 4 summary
// cards + 2 list sections (ledger + requests). No data fetch.
// No client JS. Pure RSC + the shared `Skeleton` primitive.

import { Skeleton } from '@foundations/ui/primitives/Skeleton'
import styles from './loading.module.css'

export default function AdminPartnerPayoutsLoading() {
  return (
    <main id="main" className={styles.page} aria-busy="true" aria-label="Loading…">
      <header className={styles.hero} aria-hidden="true">
        <div className={styles.heroText}>
          <Skeleton width={120} height={11} radius={6} ariaLabel="" />
          <Skeleton width="55%" height={28} radius={6} ariaLabel="" />
          <Skeleton width="35%" height={14} radius={6} ariaLabel="" />
        </div>
        <div className={styles.heroBadges}>
          <Skeleton width={90} height={24} radius={999} ariaLabel="" />
          <Skeleton width={140} height={13} radius={6} ariaLabel="" />
          <Skeleton width={120} height={12} radius={6} ariaLabel="" />
        </div>
      </header>

      <section className={styles.summary} aria-hidden="true">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className={styles.summaryRow}>
            <Skeleton width={140} height={13} radius={6} ariaLabel="" />
            <Skeleton width={100} height={18} radius={6} ariaLabel="" />
          </div>
        ))}
      </section>

      <section aria-hidden="true">
        <header className={styles.sectionHeader}>
          <Skeleton width={120} height={12} radius={6} ariaLabel="" />
          <Skeleton width="40%" height={13} radius={6} ariaLabel="" />
        </header>
        <ul className={styles.list}>
          {Array.from({ length: 5 }, (_, i) => (
            <li key={i} className={styles.listItem}>
              <Skeleton width={70} height={12} radius={6} ariaLabel="" />
              <div>
                <Skeleton width="50%" height={13} radius={6} ariaLabel="" />
                <Skeleton width="30%" height={12} radius={6} ariaLabel="" />
              </div>
              <Skeleton width={90} height={24} radius={999} ariaLabel="" />
              <Skeleton width={80} height={16} radius={6} ariaLabel="" />
            </li>
          ))}
        </ul>
      </section>

      <section aria-hidden="true">
        <header className={styles.sectionHeader}>
          <Skeleton width={120} height={12} radius={6} ariaLabel="" />
          <Skeleton width="40%" height={13} radius={6} ariaLabel="" />
        </header>
        <ul className={styles.list}>
          {Array.from({ length: 3 }, (_, i) => (
            <li key={i} className={styles.listItem}>
              <Skeleton width={70} height={12} radius={6} ariaLabel="" />
              <div>
                <Skeleton width="60%" height={13} radius={6} ariaLabel="" />
                <Skeleton width="35%" height={12} radius={6} ariaLabel="" />
              </div>
              <Skeleton width={100} height={16} radius={6} ariaLabel="" />
              <Skeleton width={90} height={24} radius={999} ariaLabel="" />
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}