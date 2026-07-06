// Account overview loading fallback. Renders while
// `app/account/page.tsx` streams in (it awaits requireUser + 2
// parallel count queries). Mirrors the overview shape — header +
// 3-KPI grid + get-started card.
//
// No data fetch. No client JS. Pure RSC + the shared `Skeleton` primitive.

import { Skeleton } from '@foundations/ui/primitives/Skeleton'
import styles from './loading.module.css'

export default function AccountOverviewLoading() {
  return (
    <div className={styles.wrap} aria-busy="true" aria-label="Loading…">
      <header className={styles.header} aria-hidden="true">
        <Skeleton width="50%" height={32} radius={8} ariaLabel="" />
        <Skeleton width="40%" height={14} radius={6} ariaLabel="" />
      </header>

      <section className={styles.kpis} aria-hidden="true">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className={styles.kpiCard}>
            <Skeleton width={80} height={11} radius={6} ariaLabel="" />
            <Skeleton width="50%" height={28} radius={6} ariaLabel="" />
          </div>
        ))}
      </section>

      <section className={styles.card} aria-hidden="true">
        <Skeleton width={140} height={18} radius={6} ariaLabel="" />
        <Skeleton count={3} ariaLabel="" />
      </section>
    </div>
  )
}
