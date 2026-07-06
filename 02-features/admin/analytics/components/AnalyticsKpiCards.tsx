// AnalyticsKpiCards.tsx — the 6-card KPI row at the top of
// /admin/analytics. RSC, zero client JS. Each card is the canonical
// "label + value" pill with the count in tabular-nums.
//
// Slice 1 renders the 6 KPIs from the analytics_daily aggregate.
// Charts, top-10 lists, funnel, and cohort grid land in Slices 2-5
// (filed as STUB-127).

import { formatMoney } from '@foundations/money/cents'
import {
  ANALYTICS_KPI_CARDS,
  type AnalyticsKpi,
  type AnalyticsRange,
} from '../types'
import styles from './AnalyticsKpiCards.module.css'

export type AnalyticsKpiCardsProps = {
  kpi: AnalyticsKpi
  range: AnalyticsRange
}

export function AnalyticsKpiCards({ kpi, range }: AnalyticsKpiCardsProps) {
  return (
    <section
      className={styles.row}
      aria-label="Analytics KPIs"
      data-range-kind={range.kind}
    >
      {ANALYTICS_KPI_CARDS.map((card) => {
        const rawValue = kpi[card.key]
        const display = card.isPercent
          ? `${formatNumber(rawValue, 2)}%`
          : card.key === 'totalRevenueCents'
            ? formatMoney(rawValue, 'USD')
            : rawValue.toLocaleString('en-US')
        return (
          <div key={card.key} className={styles.card} data-stat={card.key}>
            <p className={styles.label}>{card.label}</p>
            <p className={styles.value}>{display}</p>
          </div>
        )
      })}
    </section>
  )
}

function formatNumber(n: number, decimals: number): string {
  if (!Number.isFinite(n)) return '0'
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}