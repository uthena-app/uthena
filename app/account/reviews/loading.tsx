// Account reviews loading fallback. Renders while
// `app/account/reviews/page.tsx` streams in (it awaits requireUser +
// 2 parallel queries). Mirrors the reviews surface — header + my-
// reviews list + reviewable-products list.
//
// No data fetch. No client JS. Pure RSC + the shared `Skeleton` primitive.

import { Skeleton } from '@foundations/ui/primitives/Skeleton'
import styles from './loading.module.css'

export default function AccountReviewsLoading() {
  return (
    <div className={styles.wrap} aria-busy="true" aria-label="Loading…">
      <header className={styles.header} aria-hidden="true">
        <Skeleton width="30%" height={28} radius={8} ariaLabel="" />
        <Skeleton width="60%" height={14} radius={6} ariaLabel="" />
      </header>

      <section className={styles.section} aria-hidden="true">
        <Skeleton width={140} height={12} radius={6} ariaLabel="" />
        <ul className={styles.list}>
          {Array.from({ length: 3 }, (_, i) => (
            <li key={i} className={styles.row}>
              <div className={styles.rowHead}>
                <Skeleton width={120} height={14} radius={6} ariaLabel="" />
                <Skeleton width={80} height={11} radius={6} ariaLabel="" />
              </div>
              <Skeleton count={3} ariaLabel="" />
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.section} aria-hidden="true">
        <Skeleton width={180} height={12} radius={6} ariaLabel="" />
        <ul className={styles.list}>
          {Array.from({ length: 3 }, (_, i) => (
            <li key={i} className={styles.row}>
              <Skeleton width="60%" height={14} radius={6} ariaLabel="" />
              <Skeleton width={80} height={32} radius={6} ariaLabel="" />
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
