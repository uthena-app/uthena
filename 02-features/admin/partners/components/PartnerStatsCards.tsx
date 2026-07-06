// PartnerStatsCards.tsx — the 5-card stats row at the top of
// /admin/partners (spec line 15): total partners, pending review,
// suspended, approved this month, lifetime partner revenue. Pure RSC;
// no client JS. Each card is a 2-line "label + value" pill with the
// count in tabular-nums. The revenue card uses formatMoney to render
// currency.

import { formatMoney } from '@foundations/money/cents'
import { partnerStatsChips } from '../queries/getAdminPartnerStats'
import type { PartnerStats } from '../types'
import styles from './PartnerStatsCards.module.css'

export function PartnerStatsCards({ stats }: { stats: PartnerStats }) {
  const chips = partnerStatsChips(stats)
  return (
    <section className={styles.row} aria-label="Partner stats">
      {chips.map((chip) => (
        <div key={chip.key} className={styles.card} data-stat={chip.key}>
          <p className={styles.label}>{chip.label}</p>
          <p className={styles.value}>
            {chip.key === 'lifetimeRevenue'
              ? formatMoney(Number(chip.count))
              : Number(chip.count).toLocaleString('en-US')}
          </p>
        </div>
      ))}
    </section>
  )
}