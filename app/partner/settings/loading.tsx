// Partner settings loading fallback. Renders while
// `app/partner/settings/page.tsx` streams in (it awaits requirePartner
// + getMyPartnerProfile). Mirrors the settings form shape — header +
// stacked form sections (label + input per row).
//
// No data fetch. No client JS. Pure RSC + the shared `Skeleton` primitive.

import { Skeleton } from '@foundations/ui/primitives/Skeleton'
import styles from './loading.module.css'

export default function PartnerSettingsLoading() {
  return (
    <main id="main" className={styles.page} aria-busy="true" aria-label="Loading…">
      <header className={styles.header} aria-hidden="true">
        <Skeleton width="30%" height={28} radius={8} ariaLabel="" />
        <Skeleton width="70%" height={14} radius={6} ariaLabel="" />
      </header>

      <section className={styles.section} aria-hidden="true">
        <Skeleton width={120} height={12} radius={6} ariaLabel="" />
        <div className={styles.fields}>
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className={styles.field}>
              <Skeleton width={100} height={11} radius={6} ariaLabel="" />
              <Skeleton height={44} radius={10} ariaLabel="" />
            </div>
          ))}
        </div>
      </section>

      <section className={styles.section} aria-hidden="true">
        <Skeleton width={140} height={12} radius={6} ariaLabel="" />
        <div className={styles.fields}>
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className={styles.field}>
              <Skeleton width={100} height={11} radius={6} ariaLabel="" />
              <Skeleton height={44} radius={10} ariaLabel="" />
            </div>
          ))}
        </div>
      </section>

      <Skeleton width={180} height={44} radius={999} ariaLabel="" />
    </main>
  )
}
