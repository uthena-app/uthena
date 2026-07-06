// LinksStatsRow.tsx — P13.5 stats row for /affiliate/links.
//
// Renders the 4 stat cards the spec mandates (acceptance #4):
//   1. Total links         — count of active affiliate_links rows
//   2. Total clicks (30d)  — sum of clicks_30d across links
//   3. Total conversions (30d) — sum of conversions_30d
//   4. Avg conversion rate (30d) — weighted by clicks; "—" when 0 clicks
//
// RSC, zero client JS. Visually mirrors KpiCards (same grid shape,
// same label/value/subtle rhythm) so the link page sits next to the
// dashboard without a jarring typography shift.

import styles from './LinksStatsRow.module.css'

import type { AffiliateLinksStats } from '../queries/getMyAffiliateLinks'

function formatNumber(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0'
  return Math.trunc(n).toLocaleString('en-US')
}

/** Formatted percent — "0%" when denominator is 0. Matches the
 *  KpiCards.formatPercent helper so the two surfaces agree on
 *  precision rules. Kept local because KpiCards' version is not
 *  exported (intentional — those rule tweaks belong to the page
 *  that owns them, not the foundation). */
function formatPercent(numerator: number, denominator: number): string {
  if (!denominator) return '0%'
  const pct = (numerator / denominator) * 100
  if (pct === 0) return '0%'
  if (Number.isInteger(pct) || pct >= 100) {
    return `${Math.round(pct)}%`
  }
  return `${pct.toFixed(1)}%`
}

export function LinksStatsRow({ stats }: { stats: AffiliateLinksStats }) {
  const noClicks = stats.totalClicks30d === 0
  return (
    <section
      className={styles.grid}
      aria-label="Link performance totals"
      data-empty={noClicks ? 'true' : 'false'}
    >
      <article className={styles.tile} aria-label="Total links">
        <p className={styles.label}>Total links</p>
        <p className={styles.value}>{formatNumber(stats.totalLinks)}</p>
        <p className={styles.subtle}>
          {stats.totalLinks === 1 ? 'Active link' : 'Active links'}
        </p>
      </article>

      <article className={styles.tile} aria-label="Total clicks in last 30 days">
        <p className={styles.label}>Clicks (30d)</p>
        <p className={styles.value}>{formatNumber(stats.totalClicks30d)}</p>
        <p className={styles.subtle}>Across all links</p>
      </article>

      <article
        className={styles.tile}
        aria-label="Total conversions in last 30 days"
      >
        <p className={styles.label}>Conversions (30d)</p>
        <p className={styles.value}>{formatNumber(stats.totalConversions30d)}</p>
        <p className={styles.subtle}>Attributed sales</p>
      </article>

      <article
        className={styles.tile}
        aria-label="Average conversion rate in last 30 days"
        data-state={noClicks ? 'empty' : 'live'}
      >
        <p className={styles.label}>Conversion rate (30d)</p>
        <p className={styles.value}>
          {stats.avgConversionRate30d === null ? (
            <span className={styles.muted}>—</span>
          ) : (
            formatPercent(stats.totalConversions30d, stats.totalClicks30d)
          )}
        </p>
        <p className={styles.subtle}>
          {stats.totalConversions30d} of {stats.totalClicks30d} clicks
        </p>
      </article>
    </section>
  )
}
