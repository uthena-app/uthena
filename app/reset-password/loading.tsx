// Reset-password loading fallback. Renders while
// `app/reset-password/page.tsx` streams in. Mirrors the auth page
// shape — a centered 460px card with title + lede + 1 form field
// (email) + submit button + "back to sign in" link.
//
// No data fetch. No client JS. Pure RSC + the shared `Skeleton` primitive.

import { Skeleton } from '@foundations/ui/primitives/Skeleton'
import styles from './loading.module.css'

export default function ResetPasswordLoading() {
  return (
    <main id="main" className={styles.page} aria-busy="true" aria-label="Loading…">
      <div className={styles.card} aria-hidden="true">
        <div className={styles.header}>
          <Skeleton width="70%" height={28} radius={8} ariaLabel="" />
          <Skeleton count={2} ariaLabel="" />
        </div>

        <div className={styles.field}>
          <Skeleton width={80} height={12} radius={6} ariaLabel="" />
          <Skeleton height={44} radius={10} ariaLabel="" />
        </div>

        <Skeleton height={48} radius={999} ariaLabel="" />
        <Skeleton width="40%" height={12} radius={6} ariaLabel="" />
      </div>
    </main>
  )
}
