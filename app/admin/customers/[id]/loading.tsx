// /admin/customers/[id] — loading skeleton. Mirrors the page shape:
// header + 9-tab nav + 3-section overview cards. Pure RSC, no client JS.

import { Skeleton } from '@foundations/ui/primitives/Skeleton'
import styles from './loading.module.css'

export default function AdminCustomerDetailLoading() {
  return (
    <div className={styles.shell} aria-busy="true" aria-label="Loading…">
      <div className={styles.crumb} aria-hidden="true">
        <Skeleton width={140} height={14} radius={6} ariaLabel="" />
      </div>

      <header className={styles.header} aria-hidden="true">
        <Skeleton width={280} height={28} radius={8} ariaLabel="" />
        <Skeleton width={360} height={14} radius={6} ariaLabel="" />
      </header>

      <nav className={styles.tabbar} aria-hidden="true">
        {Array.from({ length: 9 }, (_, i) => (
          <Skeleton key={i} width={80} height={32} radius={6} ariaLabel="" />
        ))}
      </nav>

      <section className={styles.card} aria-hidden="true">
        <Skeleton width="40%" height={18} radius={6} ariaLabel="" />
        <Skeleton width="100%" height={48} radius={8} ariaLabel="" />
      </section>

      <section className={styles.card} aria-hidden="true">
        <Skeleton width="30%" height={18} radius={6} ariaLabel="" />
        <div className={styles.statsRow}>
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className={styles.statTile}>
              <Skeleton width="80%" height={11} radius={6} ariaLabel="" />
              <Skeleton width="50%" height={18} radius={6} ariaLabel="" />
            </div>
          ))}
        </div>
      </section>

      <section className={styles.card} aria-hidden="true">
        <Skeleton width="30%" height={18} radius={6} ariaLabel="" />
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className={styles.dlRow}>
            <Skeleton width={120} height={14} radius={6} ariaLabel="" />
            <Skeleton width="60%" height={14} radius={6} ariaLabel="" />
          </div>
        ))}
      </section>
    </div>
  )
}