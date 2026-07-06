// Account profile loading fallback. Renders while
// `app/account/profile/page.tsx` streams in (it awaits requireUser +
// 2 parallel profile queries). Mirrors the profile page shape —
// header + form (stacked rows: label + input) + danger zone.
//
// No data fetch. No client JS. Pure RSC + the shared `Skeleton` primitive.

import { Skeleton } from '@foundations/ui/primitives/Skeleton'
import styles from './loading.module.css'

export default function AccountProfileLoading() {
  return (
    <div className={styles.wrap} aria-busy="true" aria-label="Loading…">
      <header className={styles.header} aria-hidden="true">
        <Skeleton width="30%" height={28} radius={8} ariaLabel="" />
        <Skeleton width="50%" height={14} radius={6} ariaLabel="" />
      </header>

      <section className={styles.section} aria-hidden="true">
        <div className={styles.fields}>
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className={styles.field}>
              <Skeleton width={100} height={11} radius={6} ariaLabel="" />
              <Skeleton height={44} radius={10} ariaLabel="" />
            </div>
          ))}
        </div>
        <Skeleton width={120} height={44} radius={999} ariaLabel="" />
      </section>

      <section className={styles.danger} aria-hidden="true">
        <Skeleton width={120} height={14} radius={6} ariaLabel="" />
        <Skeleton count={2} ariaLabel="" />
        <Skeleton width={180} height={44} radius={999} ariaLabel="" />
      </section>
    </div>
  )
}
