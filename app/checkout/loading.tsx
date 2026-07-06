// Checkout loading fallback. Renders while `app/checkout/page.tsx`
// streams in (it awaits requireUser() + cart queries + Stripe config
// check). Mirrors the checkout shape — header + 2-col (order items
// on the left, summary card + trust list on the right).
//
// No data fetch. No client JS. Pure RSC + the shared `Skeleton` primitive.

import { Skeleton } from '@foundations/ui/primitives/Skeleton'
import styles from './loading.module.css'

export default function CheckoutLoading() {
  return (
    <main id="main" className={styles.page} aria-busy="true" aria-label="Loading…">
      <Skeleton width={140} height={32} radius={8} ariaLabel="" />

      <div className={styles.layout}>
        <section className={styles.left} aria-hidden="true">
          {/* Items section */}
          <Skeleton width={80} height={12} radius={6} ariaLabel="" />
          <ul className={styles.items}>
            {Array.from({ length: 2 }, (_, i) => (
              <li key={i} className={styles.item}>
                <Skeleton width={80} height={50} radius={6} ariaLabel="" />
                <div className={styles.itemBody}>
                  <Skeleton width="75%" height={16} radius={6} ariaLabel="" />
                  <Skeleton width="40%" height={12} radius={6} ariaLabel="" />
                </div>
                <Skeleton width={70} height={16} radius={6} ariaLabel="" />
              </li>
            ))}
          </ul>

          {/* Contact section */}
          <Skeleton width={80} height={12} radius={6} ariaLabel="" />
          <Skeleton count={2} ariaLabel="" />
        </section>

        <aside className={styles.right} aria-label="Order summary loading">
          <Skeleton width="50%" height={14} radius={6} ariaLabel="" />
          <div className={styles.totals}>
            <div className={styles.row}>
              <Skeleton width={80} height={14} radius={6} ariaLabel="" />
              <Skeleton width={80} height={14} radius={6} ariaLabel="" />
            </div>
            <div className={styles.row}>
              <Skeleton width={80} height={14} radius={6} ariaLabel="" />
              <Skeleton width={120} height={12} radius={6} ariaLabel="" />
            </div>
            <div className={styles.row}>
              <Skeleton width={80} height={16} radius={6} ariaLabel="" />
              <Skeleton width={80} height={18} radius={6} ariaLabel="" />
            </div>
          </div>
          <Skeleton height={48} radius={999} ariaLabel="" />
          <ul className={styles.trust} aria-hidden="true">
            {Array.from({ length: 3 }, (_, i) => (
              <li key={i}>
                <Skeleton width="80%" height={12} radius={6} ariaLabel="" />
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </main>
  )
}
