// Account orders loading fallback. Renders while
// `app/account/orders/page.tsx` streams in (it awaits requireUser +
// getMyOrders). Mirrors the orders list shape — header + filter row +
// orders table.
//
// No data fetch. No client JS. Pure RSC + the shared `Skeleton` primitive.

import { Skeleton } from '@foundations/ui/primitives/Skeleton'
import styles from './loading.module.css'

export default function AccountOrdersLoading() {
  return (
    <div className={styles.wrap} aria-busy="true" aria-label="Loading…">
      <header className={styles.header} aria-hidden="true">
        <Skeleton width="30%" height={28} radius={8} ariaLabel="" />
        <Skeleton width="50%" height={14} radius={6} ariaLabel="" />
      </header>

      {/* Filter row */}
      <div className={styles.filters} aria-hidden="true">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} width={90} height={28} radius={999} ariaLabel="" />
        ))}
      </div>

      {/* Orders table */}
      <ul className={styles.list} aria-hidden="true">
        {Array.from({ length: 6 }, (_, i) => (
          <li key={i} className={styles.row}>
            <Skeleton width={80} height={11} radius={6} ariaLabel="" />
            <Skeleton width="40%" height={14} radius={6} ariaLabel="" />
            <Skeleton width={80} height={24} radius={999} ariaLabel="" />
            <Skeleton width={80} height={14} radius={6} ariaLabel="" />
            <Skeleton width={60} height={24} radius={6} ariaLabel="" />
          </li>
        ))}
      </ul>
    </div>
  )
}
