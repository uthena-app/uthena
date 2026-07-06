// /account/orders/[id]/refund/sent loading fallback. Renders while
// the RSC page streams in (it awaits requireUser + getRefundConfirmation).
//
// Mirrors the page shape: checkmark + title + reference + body +
// "What happens next" card + 2 action buttons. Pure Skeleton
// primitives + `aria-busy` + `aria-label`. No data fetch. No
// client JS. Pure RSC.
//
// Phase 0 P0.24 contract: every long-running route ships a loading.tsx
// that mirrors the page shape with the shared `Skeleton` primitive.

import { Skeleton } from '@foundations/ui/primitives/Skeleton'
import styles from './loading.module.css'

export default function AccountRefundSentLoading() {
  return (
    <div className={styles.wrap} aria-busy="true" aria-label="Loading…">
      <header className={styles.iconRow} aria-hidden="true">
        <Skeleton width={40} height={40} radius={20} ariaLabel="" />
        <Skeleton width="60%" height={28} radius={8} ariaLabel="" />
      </header>

      <div className={styles.refLine} aria-hidden="true">
        <Skeleton width={120} height={18} radius={6} ariaLabel="" />
      </div>

      <div className={styles.body} aria-hidden="true">
        <Skeleton width="85%" height={14} radius={6} ariaLabel="" />
      </div>

      <section className={styles.next} aria-hidden="true">
        <Skeleton width="40%" height={14} radius={6} ariaLabel="" />
        <div className={styles.steps}>
          <Skeleton width="95%" height={12} radius={6} ariaLabel="" />
          <Skeleton width="90%" height={12} radius={6} ariaLabel="" />
          <Skeleton width="92%" height={12} radius={6} ariaLabel="" />
        </div>
      </section>

      <div className={styles.actions} aria-hidden="true">
        <Skeleton width={140} height={40} radius={8} ariaLabel="" />
        <Skeleton width={170} height={40} radius={8} ariaLabel="" />
      </div>
    </div>
  )
}
