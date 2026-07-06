// Partner ledger entry detail — loading fallback. Mirrors the
// detail page shape: crumb + hero header + status timeline +
// 1-2 cards. No data fetch. No client JS. Pure RSC + the shared
// `Skeleton` primitive.

import { Skeleton } from '@foundations/ui/primitives/Skeleton'
import styles from './loading.module.css'

export default function PartnerLedgerEntryDetailLoading() {
  return (
    <main
      id="main"
      className={styles.page}
      aria-busy="true"
      aria-label="Loading…"
    >
      <Skeleton width={180} height={14} radius={6} ariaLabel="" />

      <header className={styles.hero} aria-hidden="true">
        <div>
          <Skeleton width={100} height={11} radius={6} ariaLabel="" />
          <Skeleton width="55%" height={32} radius={8} ariaLabel="" />
          <Skeleton width="70%" height={14} radius={6} ariaLabel="" />
        </div>
        <div className={styles.heroNumbers}>
          <Skeleton width={140} height={32} radius={8} ariaLabel="" />
          <Skeleton width={100} height={24} radius={999} ariaLabel="" />
        </div>
      </header>

      <section className={styles.timeline} aria-hidden="true">
        <Skeleton width="40%" height={14} radius={6} ariaLabel="" />
        <div className={styles.timelineRow}>
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className={styles.timelineItem}>
              <Skeleton width={14} height={14} radius={999} ariaLabel="" />
              <Skeleton width="80%" height={12} radius={6} ariaLabel="" />
              <Skeleton width="50%" height={12} radius={6} ariaLabel="" />
            </div>
          ))}
        </div>
      </section>

      <section className={styles.card} aria-hidden="true">
        <Skeleton width={140} height={11} radius={6} ariaLabel="" />
        <Skeleton width="35%" height={20} radius={6} ariaLabel="" />
        <div className={styles.cardGrid}>
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i}>
              <Skeleton width="60%" height={11} radius={6} ariaLabel="" />
              <Skeleton width="40%" height={14} radius={6} ariaLabel="" />
            </div>
          ))}
        </div>
      </section>
    </main>
  )
}
