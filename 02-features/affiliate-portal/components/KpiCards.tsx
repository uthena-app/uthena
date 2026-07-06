// KpiCards.tsx — P13.3 dashboard KPI grid.
//
// Renders the 4 KPI cards the spec mandates:
//   1. This month earnings (USD, bigint-safe money)
//   2. Lifetime earned   (USD)
//   3. Clicks (30d)
//   4. Conversion rate   (conversions / clicks, %, 0% when 0 clicks)
//
// RSC, zero client JS. Money is bigint cents → formatted via
// `formatMoney` from @foundations/money/cents (the canonical
// currency formatter — handles zero, bigint, and currency properly).
//
// Empty state: when lifetimeEarnedCents === 0 AND clicks30d === 0,
// the grid still renders but each tile shows "$0.00" / "0" / "0%"
// with a subtle "No activity yet" subtitle inside the empty
// lifetime tile. (The other 3 tiles show their zeros without
// commentary.)

import { formatMoney } from '@foundations/money/cents'
import styles from './KpiCards.module.css'

import type { AffiliateSummary } from '../queries/getAffiliateDashboard'

function formatPercent(numerator: number, denominator: number): string {
  if (!denominator) return '0%'
  const pct = (numerator / denominator) * 100
  // Cap precision: 1 decimal for low-volume, no decimals for whole
  // numbers. Avoid ".0%" noise like "0.0%" but keep "12.5%" readable.
  if (pct === 0) return '0%'
  if (Number.isInteger(pct) || pct >= 100) {
    return `${Math.round(pct)}%`
  }
  return `${pct.toFixed(1)}%`
}

export function KpiCards({ summary }: { summary: AffiliateSummary }) {
  const hasAnyActivity =
    summary.lifetimeEarnedCents > 0 ||
    summary.monthEarnedCents > 0 ||
    summary.clicks30d > 0

  return (
    <section
      className={styles.grid}
      aria-label="Key performance metrics"
      data-empty={!hasAnyActivity ? 'true' : 'false'}
    >
      <article className={styles.tile} aria-label="Lifetime earned">
        <p className={styles.label}>Lifetime earned</p>
        <p className={styles.value}>
          {formatMoney(summary.lifetimeEarnedCents, 'USD')}
        </p>
        {!hasAnyActivity ? (
          <p className={styles.subtle}>No activity yet</p>
        ) : null}
      </article>

      <article className={styles.tile} aria-label="Earnings this month">
        <p className={styles.label}>This month</p>
        <p className={styles.value}>
          {formatMoney(summary.monthEarnedCents, 'USD')}
        </p>
        <p className={styles.subtle}>Since {getMonthStartLabel()}</p>
      </article>

      <article className={styles.tile} aria-label="Clicks in last 30 days">
        <p className={styles.label}>Clicks (30d)</p>
        <p className={styles.value}>{summary.clicks30d.toLocaleString('en-US')}</p>
        <p className={styles.subtle}>Last 30 days</p>
      </article>

      <article
        className={styles.tile}
        aria-label="Conversion rate in last 30 days"
      >
        <p className={styles.label}>Conversion rate (30d)</p>
        <p className={styles.value}>
          {formatPercent(summary.conversions30d, summary.clicks30d)}
        </p>
        <p className={styles.subtle}>
          {summary.conversions30d} of {summary.clicks30d} clicks
        </p>
      </article>
    </section>
  )
}

/** Returns a short "Jan 1" style label for the current month-start
 *  date (UTC; matches the SQL `date_trunc('month', now())` boundary
 *  the RPC uses). */
function getMonthStartLabel(): string {
  const now = new Date()
  const monthNames = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ]
  return `${monthNames[now.getUTCMonth()]} 1`
}
