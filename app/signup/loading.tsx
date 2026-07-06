// Signup loading fallback. Renders while `app/signup/page.tsx` streams
// in. Mirrors the auth page shape — a centered 460px card with title +
// lede + 3 form fields (email, password, confirm) + submit button +
// terms checkbox + "already have an account?" link.
//
// No data fetch. No client JS. Pure RSC + the shared `Skeleton` primitive.

import { Skeleton } from '@foundations/ui/primitives/Skeleton'
import styles from './loading.module.css'

export default function SignupLoading() {
  return (
    <main id="main" className={styles.page} aria-busy="true" aria-label="Loading…">
      <div className={styles.card} aria-hidden="true">
        <div className={styles.header}>
          <Skeleton width="55%" height={28} radius={8} ariaLabel="" />
          <Skeleton count={2} ariaLabel="" />
        </div>

        <div className={styles.fields}>
          <div className={styles.field}>
            <Skeleton width={80} height={12} radius={6} ariaLabel="" />
            <Skeleton height={44} radius={10} ariaLabel="" />
          </div>
          <div className={styles.field}>
            <Skeleton width={120} height={12} radius={6} ariaLabel="" />
            <Skeleton height={44} radius={10} ariaLabel="" />
          </div>
          <div className={styles.field}>
            <Skeleton width={140} height={12} radius={6} ariaLabel="" />
            <Skeleton height={44} radius={10} ariaLabel="" />
          </div>
        </div>

        {/* Terms checkbox row */}
        <Skeleton width="85%" height={14} radius={6} ariaLabel="" />

        <Skeleton height={48} radius={999} ariaLabel="" />
        <Skeleton width="65%" height={12} radius={6} ariaLabel="" />
      </div>
    </main>
  )
}
