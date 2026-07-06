// Verify-email loading fallback. Renders while
// `app/verify-email/page.tsx` streams in (it awaits getSessionUser()
// before deciding which branch to render). Mirrors the auth card
// shape — centered 460px card with title + lede + CTA button.
//
// No data fetch. No client JS. Pure RSC + the shared `Skeleton` primitive.

import { Skeleton } from '@foundations/ui/primitives/Skeleton'
import styles from './loading.module.css'

export default function VerifyEmailLoading() {
  return (
    <main id="main" className={styles.page} aria-busy="true" aria-label="Loading…">
      <div className={styles.card} aria-hidden="true">
        <div className={styles.header}>
          <Skeleton width="50%" height={28} radius={8} ariaLabel="" />
          <Skeleton count={3} ariaLabel="" />
        </div>
        <Skeleton height={48} radius={999} ariaLabel="" />
      </div>
    </main>
  )
}
