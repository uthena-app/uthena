// EarningsChart.tsx — server-rendered inline SVG bar chart.
//
// P12.4 — companion to the dashboard's "Earnings" section.
// Reads PartnerSalesSeriesPoint[] (already mapped by
// getPartnerDailySalesExtras) and renders them as a 30-day bar
// chart in pure inline SVG. Zero client JS, zero chart library.
//
// Design notes:
//
//   - RSC + token-only styling. The chart is a visual rendering,
//     not a UI control — no hover tooltips, no zoom, no filter.
//     Future slices can add a client island for "click bar →
//     day detail." For v1 the partner sees the trajectory at a
//     glance and drills into numbers via the existing
//     /partner/sales page.
//
//   - Bar widths scale to the data max (with a min of 1 cent so
//     a single non-zero day renders sensibly against a sea of
//     zero days).
//
//   - Empty series renders a friendly "no data yet" message in
//     the card body, not a broken chart.

import type { PartnerSalesSeriesPoint } from '../queries/getPartnerDashboardExtras'
import styles from './EarningsChart.module.css'

/** USD-only display. The chart's headline number is the period
 *  total; matches the dashboard's currency convention. */
function formatUSD(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

/** Round-trip a UTC date string `YYYY-MM-DD` to a stable label
 *  for the X axis. We render the day-of-month on the axis; weeks
 *  are easy to read by the spacing. */
function dayOfMonth(day: string): string {
  // Day string is `YYYY-MM-DD` (or a longer ISO — we slice the
  // first 10 chars; the rest is irrelevant for the axis label).
  const t = new Date(day.slice(0, 10))
  if (Number.isNaN(t.getTime())) return ''
  return t.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })
}

const VIEWBOX_W = 720
const VIEWBOX_H = 200
const PADDING_X = 16
const PADDING_TOP = 24
const PADDING_BOTTOM = 32

export function EarningsChart({
  series,
  daysBack,
  totalCents,
}: {
  series: PartnerSalesSeriesPoint[]
  /** How many days back the series represents. Used for the
   *  "<N> days" caption + the X axis density. Defaults to 30. */
  daysBack: number
  /** Sum of all series.salesCents for the headline number. The
   *  page passes this so the rendering is pure (no Math.sum
   *  re-computed on the page and the chart independently). */
  totalCents: number
}) {
  // Empty series — never render a chart with no bars. The body
  // card shows a friendly message; the page should also have an
  // outer empty-state message in the future.
  const safeSeries = series ?? []
  const hasData = safeSeries.length > 0

  // Max value → bar width scaling. Zero max means "no sales in
  // the window" — render flat 1px placeholder bars so the chart
  // shape is visible (the headline number reads 0).
  const maxSales = safeSeries.reduce(
    (acc, p) => (p.salesCents > acc ? p.salesCents : acc),
    0,
  )

  const innerW = VIEWBOX_W - PADDING_X * 2
  const innerH = VIEWBOX_H - PADDING_TOP - PADDING_BOTTOM
  const barCount = Math.max(1, safeSeries.length)
  const slot = innerW / barCount
  const barWidth = Math.max(2, slot * 0.7)

  return (
    <section className={styles.card} aria-label="Earnings">
      <header className={styles.header}>
        <div>
          <h2 className={styles.h2}>Earnings — last {daysBack} days</h2>
          <p className={styles.subtle}>
            Gross daily sales, calendar-aligned (UTC). Total:{' '}
            <strong className={styles.totalValue}>{formatUSD(totalCents)}</strong>
          </p>
        </div>
      </header>

      {!hasData ? (
        <p className={styles.empty}>No sales in the last {daysBack} days.</p>
      ) : (
        <div className={styles.chartWrap}>
          <svg
            viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
            preserveAspectRatio="none"
            className={styles.svg}
            role="img"
            aria-label={`Bar chart of ${safeSeries.length} days of sales`}
          >
            {/* Horizontal grid line — single thin reference line at
                the chart mid-height. The Y axis is intentionally
                label-less for v1 (the bar peak implies scale; the
                spec keeps it light). */}
            <line
              x1={PADDING_X}
              x2={VIEWBOX_W - PADDING_X}
              y1={PADDING_TOP + innerH / 2}
              y2={PADDING_TOP + innerH / 2}
              className={styles.gridLine}
            />

            {/* Bars */}
            {safeSeries.map((p, i) => {
              const heightPx =
                maxSales > 0 ? (p.salesCents / maxSales) * innerH : 0
              const x = PADDING_X + i * slot + (slot - barWidth) / 2
              const y = PADDING_TOP + innerH - heightPx
              return (
                <rect
                  key={`${p.day}-${i}`}
                  x={x}
                  y={y}
                  width={barWidth}
                  height={Math.max(0, heightPx)}
                  rx={2}
                  className={styles.bar}
                >
                  <title>
                    {p.day}: {formatUSD(p.salesCents)} ({p.orderCount}{' '}
                    {p.orderCount === 1 ? 'order' : 'orders'})
                  </title>
                </rect>
              )
            })}

            {/* X axis labels — render only first / mid / last to
                keep the SVG readable at narrow widths. The full
                dates are available as the <title> on each bar
                (hover tooltip via the browser's native SVG title). */}
            {safeSeries.length > 0 && (
              <>
                <text
                  x={PADDING_X}
                  y={VIEWBOX_H - 8}
                  textAnchor="start"
                  className={styles.axisLabel}
                >
                  {dayOfMonth(safeSeries[0]!.day)}
                </text>
                {safeSeries.length > 1 && (
                  <text
                    x={PADDING_X + (innerW / 2)}
                    y={VIEWBOX_H - 8}
                    textAnchor="middle"
                    className={styles.axisLabel}
                  >
                    {dayOfMonth(safeSeries[Math.floor(safeSeries.length / 2)]!.day)}
                  </text>
                )}
                {safeSeries.length > 2 && (
                  <text
                    x={VIEWBOX_W - PADDING_X}
                    y={VIEWBOX_H - 8}
                    textAnchor="end"
                    className={styles.axisLabel}
                  >
                    {dayOfMonth(safeSeries[safeSeries.length - 1]!.day)}
                  </text>
                )}
              </>
            )}
          </svg>
        </div>
      )}
    </section>
  )
}
