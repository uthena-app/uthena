// OrderStatsCards.tsx — the 5-card stats row at the top of /admin/orders
// (spec line 21). Pure RSC, no client JS. Each card is a 2-line
// "label + value" pill with the count in tabular-nums. The money card
// (Paid revenue MTD) uses formatMoney from the canonical cents helper.

import { formatMoney } from '@foundations/money/cents'
import { orderStatsChips } from '../queries/getAdminOrderStats'
import type { OrderStats } from '../types'
import styles from './OrderStatsCards.module.css'

export function OrderStatsCards({ stats }: { stats: OrderStats }) {
  const chips = orderStatsChips(stats)
  return (
    <section className={styles.row} aria-label="Order stats">
      {chips.map((chip) => (
        <div key={chip.key} className={styles.card} data-stat={chip.key}>
          <p className={styles.label}>{chip.label}</p>
          <p className={styles.value}>
            {chip.isMoney
              ? formatMoney(Number(chip.value))
              : Number(chip.value).toLocaleString('en-US')}
          </p>
        </div>
      ))}
    </section>
  )
}
