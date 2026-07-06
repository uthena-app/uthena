// Update-password loading fallback. Renders while
// `app/update-password/page.tsx` streams in (it awaits a session check
// before rendering the form). Mirrors the auth page shape — centered
// 460px card with title + lede + 2 password fields (new + confirm)
// + submit button.
//
// No data fetch. No client JS. Pure RSC + the shared `Skeleton` primitive.

import { Skeleton } from '@foundations/ui/primitives/Skeleton'
import styles from './loading.module.css'

export default function UpdatePasswordLoading() {
  return (
    <main id="main" className={styles.page} aria-busy="true" aria-label="Loading…">
      <div className={styles.card} aria-hidden="true">
        <div className={styles.header}>
          <Skeleton width="65%" height={28} radius={8} ariaLabel="" />
          <Skeleton count={2} ariaLabel="" />
        </div>

        <div className={styles.fields}>
          <div className={styles.field}>
            <Skeleton width={140} height={12} radius={6} ariaLabel="" />
            <Skeleton height={44} radius={10} ariaLabel="" />
          </div>
          <div className={styles.field}>
            <Skeleton width={160} height={12} radius={6} ariaLabel="" />
            <Skeleton height={44} radius={10} ariaLabel="" />
          </div>
        </div>

        <Skeleton height={48} radius={999} ariaLabel="" />
      </div>
    </main>
  )
}
