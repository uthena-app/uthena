// Account settings loading fallback. Renders while
// `app/account/settings/page.tsx` streams in (it awaits requireUser +
// getMySettings). Mirrors the settings page shape — header + settings
// form (toggles + selects) + sessions list.
//
// No data fetch. No client JS. Pure RSC + the shared `Skeleton` primitive.

import { Skeleton } from '@foundations/ui/primitives/Skeleton'
import styles from './loading.module.css'

export default function AccountSettingsLoading() {
  return (
    <div className={styles.wrap} aria-busy="true" aria-label="Loading…">
      <header className={styles.header} aria-hidden="true">
        <Skeleton width="30%" height={28} radius={8} ariaLabel="" />
        <Skeleton width="55%" height={14} radius={6} ariaLabel="" />
      </header>

      <section className={styles.section} aria-hidden="true">
        <Skeleton width={140} height={12} radius={6} ariaLabel="" />
        <div className={styles.rows}>
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className={styles.row}>
              <div className={styles.rowBody}>
                <Skeleton width={140} height={14} radius={6} ariaLabel="" />
                <Skeleton width="60%" height={12} radius={6} ariaLabel="" />
              </div>
              <Skeleton width={44} height={24} radius={999} ariaLabel="" />
            </div>
          ))}
        </div>
        <Skeleton width={140} height={44} radius={999} ariaLabel="" />
      </section>

      <section className={styles.section} aria-hidden="true">
        <Skeleton width={120} height={12} radius={6} ariaLabel="" />
        <ul className={styles.list}>
          {Array.from({ length: 2 }, (_, i) => (
            <li key={i} className={styles.sessionRow}>
              <div className={styles.rowBody}>
                <Skeleton width="40%" height={14} radius={6} ariaLabel="" />
                <Skeleton width="60%" height={11} radius={6} ariaLabel="" />
              </div>
              <Skeleton width={80} height={28} radius={6} ariaLabel="" />
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
