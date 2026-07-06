// Login loading fallback. Renders while `app/login/page.tsx` streams in.
// Mirrors the auth page shape — a centered 460px card with a title +
// lede + 2 form fields + submit button + a "forgot password" link.
//
// No data fetch. No client JS. Pure RSC + the shared `Skeleton` primitive.

import { Skeleton } from '@foundations/ui/primitives/Skeleton'
import styles from './loading.module.css'

export default function LoginLoading() {
  return (
    <main id="main" className={styles.page} aria-busy="true" aria-label="Loading…">
      <div className={styles.card} aria-hidden="true">
        {/* Title + lede */}
        <div className={styles.header}>
          <Skeleton width="60%" height={28} radius={8} ariaLabel="" />
          <Skeleton count={2} ariaLabel="" />
        </div>

        {/* Email + password fields */}
        <div className={styles.fields}>
          <div className={styles.field}>
            <Skeleton width={80} height={12} radius={6} ariaLabel="" />
            <Skeleton height={44} radius={10} ariaLabel="" />
          </div>
          <div className={styles.field}>
            <Skeleton width={80} height={12} radius={6} ariaLabel="" />
            <Skeleton height={44} radius={10} ariaLabel="" />
          </div>
        </div>

        {/* Submit button + forgot-password link */}
        <Skeleton height={48} radius={999} ariaLabel="" />
        <Skeleton width="50%" height={12} radius={6} ariaLabel="" />
      </div>
    </main>
  )
}
