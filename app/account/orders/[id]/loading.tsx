// Account order detail loading fallback. Renders while
// `app/account/orders/[id]/page.tsx` streams in (it awaits requireUser
// + getMyOrderDetail). Mirrors the order detail shape — header +
// line items + summary panel.
//
// No data fetch. No client JS. Pure RSC + the shared `Skeleton` primitive.

import { Skeleton } from '@foundations/ui/primitives/Skeleton'
import styles from './loading.module.css'

export default function AccountOrderDetailLoading() {
  return (
    <div className={styles.wrap} aria-busy="true" aria-label="Loading…">
      <header className={styles.header} aria-hidden="true">
        <Skeleton width="40%" height={28} radius={8} ariaLabel="" />
        <Skeleton width="60%" height={14} radius={6} ariaLabel="" />
      </header>

      <section className={styles.items} aria-hidden="true">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className={styles.item}>
            <Skeleton width={80} height={50} radius={6} ariaLabel="" />
            <div className={styles.itemBody}>
              <Skeleton width="70%" height={16} radius={6} ariaLabel="" />
              <Skeleton width="40%" height={12} radius={6} ariaLabel="" />
            </div>
            <Skeleton width={70} height={16} radius={6} ariaLabel="" />
          </div>
        ))}
      </section>

      <section className={styles.summary} aria-hidden="true">
        <Skeleton width="50%" height={14} radius={6} ariaLabel="" />
        <Skeleton count={4} ariaLabel="" />
      </section>
    </div>
  )
}
