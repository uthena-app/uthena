// Partner courses loading fallback. Renders while
// `app/partner/courses/page.tsx` streams in (it awaits requirePartner
// + getMyPartnerProducts). Mirrors the courses list shape — header +
// row list (thumbnail + title + meta + status + open button).
//
// No data fetch. No client JS. Pure RSC + the shared `Skeleton` primitive.

import { Skeleton } from '@foundations/ui/primitives/Skeleton'
import styles from './loading.module.css'

export default function PartnerCoursesLoading() {
  return (
    <main id="main" className={styles.page} aria-busy="true" aria-label="Loading…">
      <header className={styles.header} aria-hidden="true">
        <div className={styles.headerLeft}>
          <Skeleton width="40%" height={28} radius={8} ariaLabel="" />
          <Skeleton width="70%" height={14} radius={6} ariaLabel="" />
        </div>
        <Skeleton width={180} height={40} radius={8} ariaLabel="" />
      </header>

      <ul className={styles.list} aria-hidden="true">
        {Array.from({ length: 5 }, (_, i) => (
          <li key={i} className={styles.row}>
            <Skeleton width={80} height={60} radius={8} ariaLabel="" />
            <div className={styles.body}>
              <Skeleton width="65%" height={16} radius={6} ariaLabel="" />
              <Skeleton width="50%" height={12} radius={6} ariaLabel="" />
              <Skeleton width={120} height={11} radius={6} ariaLabel="" />
            </div>
            <Skeleton width={80} height={24} radius={999} ariaLabel="" />
            <Skeleton width={60} height={32} radius={8} ariaLabel="" />
          </li>
        ))}
      </ul>
    </main>
  )
}
