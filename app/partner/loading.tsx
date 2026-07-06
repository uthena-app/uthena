// Partner dashboard loading fallback. Renders while
// `app/partner/page.tsx` streams in (it awaits requirePartner() +
// getPartnerDashboardSummary()). Mirrors the dashboard shape — header
// + 4-KPI grid + quick-actions grid.
//
// No data fetch. No client JS. Pure RSC + the shared `Skeleton` primitive.

import { Skeleton } from '@foundations/ui/primitives/Skeleton'
import styles from './loading.module.css'

export default function PartnerDashboardLoading() {
  return (
    <main id="main" className={styles.page} aria-busy="true" aria-label="Loading…">
      <header className={styles.header} aria-hidden="true">
        <Skeleton width="50%" height={28} radius={8} ariaLabel="" />
        <Skeleton width="70%" height={14} radius={6} ariaLabel="" />
      </header>

      <section className={styles.kpis} aria-hidden="true">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className={styles.kpiCard}>
            <Skeleton width={80} height={11} radius={6} ariaLabel="" />
            <Skeleton width="60%" height={24} radius={6} ariaLabel="" />
          </div>
        ))}
      </section>

      <section className={styles.quick}>
        <Skeleton width={140} height={16} radius={6} ariaLabel="" />
        <div className={styles.quickGrid} aria-hidden="true">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className={styles.quickCard}>
              <Skeleton width="60%" height={14} radius={6} ariaLabel="" />
              <Skeleton count={2} ariaLabel="" />
            </div>
          ))}
        </div>
      </section>
    </main>
  )
}
