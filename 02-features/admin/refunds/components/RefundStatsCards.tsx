// RefundStatsCards.tsx — the 5-card stats row at the top of /admin/refunds
// (spec line 16). Pure RSC, no client JS. Mirrors OrderStatsCards.
//
// The 5 cards match the spec line 16 + §"Data this page shows":
//   Pending / Approved / Processed / Rejected / Total
//
// The spec's vocabulary (Requested / Approved / Processed / Rejected)
// is mapped from the DB enum (`pending / approved / succeeded /
// failed`) via REFUND_STATUS_LABEL in `../types.ts`.

import { REFUND_STATUS_LABEL } from '../types'
import type { RefundStats } from '../types'
import styles from './RefundStatsCards.module.css'

export type RefundStatsCardsProps = {
  stats: RefundStats
}

type Chip = {
  key: 'pending' | 'approved' | 'succeeded' | 'failed' | 'total'
  label: string
  value: number
}

function refundStatsChips(stats: RefundStats): Chip[] {
  return [
    { key: 'pending', label: REFUND_STATUS_LABEL.pending, value: stats.pending },
    { key: 'approved', label: REFUND_STATUS_LABEL.approved, value: stats.approved },
    { key: 'succeeded', label: REFUND_STATUS_LABEL.succeeded, value: stats.succeeded },
    { key: 'failed', label: REFUND_STATUS_LABEL.failed, value: stats.failed },
    { key: 'total', label: 'Total', value: stats.total },
  ]
}

export function RefundStatsCards({ stats }: RefundStatsCardsProps) {
  const chips = refundStatsChips(stats)
  return (
    <section className={styles.row} aria-label="Refund stats">
      {chips.map((chip) => (
        <div key={chip.key} className={styles.card} data-stat={chip.key}>
          <p className={styles.label}>{chip.label}</p>
          <p className={styles.value}>
            {chip.value.toLocaleString('en-US')}
          </p>
        </div>
      ))}
    </section>
  )
}