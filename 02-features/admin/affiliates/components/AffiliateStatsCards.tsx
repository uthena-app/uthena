// AffiliateStatsCards.tsx — the 5-card stats row at the top of
// /admin/affiliates (spec line 15): total affiliates, pending review,
// suspended, approved this month, commission paid (MTD). Pure RSC;
// no client JS. Each card is a 2-line "label + value" pill with the
// count in tabular-nums. The money card uses formatMoney to render
// currency.

import { formatMoney } from '@foundations/money/cents'
import { affiliateStatsChips } from '../queries/getAdminAffiliateStats'
import type { AffiliateStats } from '../types'
import styles from './AffiliateStatsCards.module.css'

export function AffiliateStatsCards({ stats }: { stats: AffiliateStats }) {
  const chips = affiliateStatsChips(stats)
  return (
    <section className={styles.row} aria-label="Affiliate stats">
      {chips.map((chip) => (
        <div key={chip.key} className={styles.card} data-stat={chip.key}>
          <p className={styles.label}>{chip.label}</p>
          <p className={styles.value}>
            {chip.key === 'thisMonthCommissionPaidCents'
              ? formatMoney(Number(chip.count))
              : Number(chip.count).toLocaleString('en-US')}
          </p>
        </div>
      ))}
    </section>
  )
}