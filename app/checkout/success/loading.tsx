// Checkout success loading fallback. Renders while
// `app/checkout/success/page.tsx` streams in (it awaits getSessionUser
// + order lookup). Mirrors the success card shape — centered success
// icon + h1 + lede + status row + 2-col (order summary on left, CTA
// stack on right).
//
// No data fetch. No client JS. Pure RSC + the shared `Skeleton` primitive.

import { Skeleton } from '@foundations/ui/primitives/Skeleton'
import styles from './loading.module.css'

export default function CheckoutSuccessLoading() {
  return (
    <main id="main" className={styles.page} aria-busy="true" aria-label="Loading…">
      <Skeleton width={64} height={64} radius={999} ariaLabel="" />
      <Skeleton width="60%" height={32} radius={8} ariaLabel="" />
      <Skeleton width="80%" height={14} radius={6} ariaLabel="" />
      <Skeleton width="50%" height={14} radius={6} ariaLabel="" />

      <div className={styles.layout} aria-hidden="true">
        <div className={styles.summary}>
          <Skeleton width="40%" height={14} radius={6} ariaLabel="" />
          <Skeleton count={4} ariaLabel="" />
        </div>
        <div className={styles.actions}>
          <Skeleton height={48} radius={10} ariaLabel="" />
          <Skeleton height={48} radius={10} ariaLabel="" />
          <Skeleton height={36} radius={6} ariaLabel="" />
        </div>
      </div>
    </main>
  )
}
