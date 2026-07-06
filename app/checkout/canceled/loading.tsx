// Checkout canceled loading fallback. Renders while
// `app/checkout/canceled/page.tsx` streams in (it awaits getSessionUser
// + cart queries + searchParams parse). Mirrors the canceled card
// shape — centered icon + h1 + lede + (cart preview OR signin card).
//
// No data fetch. No client JS. Pure RSC + the shared `Skeleton` primitive.

import { Skeleton } from '@foundations/ui/primitives/Skeleton'
import styles from './loading.module.css'

export default function CheckoutCanceledLoading() {
  return (
    <main id="main" className={styles.page} aria-busy="true" aria-label="Loading…">
      <Skeleton width={56} height={56} radius={999} ariaLabel="" />
      <Skeleton width="55%" height={28} radius={8} ariaLabel="" />
      <Skeleton width="70%" height={14} radius={6} ariaLabel="" />

      <div className={styles.card} aria-hidden="true">
        <Skeleton count={2} ariaLabel="" />
        <ul className={styles.previewList}>
          {Array.from({ length: 3 }, (_, i) => (
            <li key={i} className={styles.previewItem}>
              <Skeleton width={64} height={40} radius={6} ariaLabel="" />
              <div className={styles.previewBody}>
                <Skeleton width="75%" height={14} radius={6} ariaLabel="" />
                <Skeleton width="40%" height={12} radius={6} ariaLabel="" />
              </div>
              <Skeleton width={60} height={14} radius={6} ariaLabel="" />
            </li>
          ))}
        </ul>
        <Skeleton width="50%" height={14} radius={6} ariaLabel="" />
        <div className={styles.actions}>
          <Skeleton height={44} radius={10} ariaLabel="" />
          <Skeleton height={44} radius={10} ariaLabel="" />
        </div>
      </div>
    </main>
  )
}
