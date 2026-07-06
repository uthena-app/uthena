// /admin/partners — loading skeleton. Mirrors the page shape:
// stats row + filter bar + table + pagination. Pure RSC, no client JS.

import { Skeleton } from '@foundations/ui/primitives/Skeleton'
import styles from './loading.module.css'

export default function AdminPartnersLoading() {
  return (
    <div className={styles.shell} aria-busy="true" aria-label="Loading…">
      <header className={styles.header} aria-hidden="true">
        <Skeleton width={200} height={28} radius={8} ariaLabel="" />
        <Skeleton width={480} height={14} radius={6} ariaLabel="" />
      </header>

      <section className={styles.stats} aria-hidden="true">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className={styles.statCard}>
            <Skeleton width={100} height={11} radius={6} ariaLabel="" />
            <Skeleton width="60%" height={24} radius={6} ariaLabel="" />
          </div>
        ))}
      </section>

      <div className={styles.filterBar} aria-hidden="true">
        <Skeleton width="100%" height={88} radius={8} ariaLabel="" />
      </div>

      <div className={styles.tableWrap} aria-hidden="true">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} width="100%" height={44} radius={6} ariaLabel="" />
        ))}
      </div>
    </div>
  )
}