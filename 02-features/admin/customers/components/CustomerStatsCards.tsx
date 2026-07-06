// CustomerStatsCards.tsx — the 5-card stats row at the top of
// /admin/customers (spec line 15): total, active, suspended, banned,
// new-this-month. Pure RSC; no client JS. Each card is a 2-line
// "label + value" pill with the count in tabular-nums.

import { customerStatsChips } from '../queries/getAdminCustomerStats'
import type { CustomerStats } from '../types'
import styles from './CustomerStatsCards.module.css'

export function CustomerStatsCards({ stats }: { stats: CustomerStats }) {
  const chips = customerStatsChips(stats)
  return (
    <section className={styles.row} aria-label="Customer stats">
      {chips.map((chip) => (
        <div key={chip.key} className={styles.card} data-stat={chip.key}>
          <p className={styles.label}>{chip.label}</p>
          <p className={styles.value}>{chip.count.toLocaleString('en-US')}</p>
        </div>
      ))}
    </section>
  )
}