// PerformanceChart.tsx — P13.4 affiliate time-series performance chart.
//
// Inline SVG, RSC, zero client JS. Reads the
// `AffiliateDailyPerformancePoint[]` mapped by
// `getAffiliateDailyPerformance` and renders:
//   - 3 headline stat tiles above the chart (Clicks, Conversions,
//     Revenue) — sum of the series
//   - A 30-day bar+marker chart with revenue as the primary bars
//     and click/conversion counts as proportional dot markers
//     (clicks + conversions are count metrics, not money — a marker
//     avoids double-Y-axis confusion while still showing both shapes)
//   - X axis: first / mid / last day label (matches P12.4
//     EarningsChart axis-density pattern)
//   - Empty state: "No clicks or conversions in the last N days"
//     when the entire series is zero
//
// **Design notes:**
//   - RSC, no hover tooltips, no zoom, no filter. The chart is a
//     visual rendering. Future slices can add a client island for
//     "click day → day detail." For v1 the affiliate sees the
//     trajectory at a glance and drills into numbers via the KPI
//     cards (clicks_30d / conversions_30d) + the upcoming
//     RecentCommissions table.
//   - Bars use the teal affiliate DNA `--accent`; markers use
//     `--success` for clicks + `--warn-line` for conversions —
//     reusing the existing dashboard tokens so a future global
//     theme change cascades here.
//   - Money in bigint cents → `formatMoney` from the canonical
//     money helpers (no raw `$` math).

import type { AffiliateDailyPerformancePoint } from '../queries/getAffiliateDailyPerformance'
import { formatMoney } from '@foundations/money/cents'
import styles from './PerformanceChart.module.css'

/** Round a YYYY-MM-DD day string to a short axis label like `Jun 1`. */
function dayLabel(day: string): string {
  const t = new Date(day.slice(0, 10))
  if (Number.isNaN(t.getTime())) return ''
  return t.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })
}

const VIEWBOX_W = 720
const VIEWBOX_H = 200
const PADDING_X = 16
const PADDING_TOP = 24
const PADDING_BOTTOM = 32

export function PerformanceChart({
  series,
  daysBack,
}: {
  series: AffiliateDailyPerformancePoint[]
  /** How many days back the series represents. Used for the
   *  "Last N days" caption + the empty state copy. Defaults to
   *  the query's 30-day default. */
  daysBack: number
}) {
  const safeSeries = series ?? []
  const hasData = safeSeries.length > 0

  // Aggregate the 3 series for the headline tiles. Defensive
  // against null/undefined — always finite, ≥0 numbers.
  const totals = safeSeries.reduce(
    (acc, p) => ({
      clicks: acc.clicks + (p.clicksCount > 0 ? p.clicksCount : 0),
      conversions:
        acc.conversions + (p.conversionsCount > 0 ? p.conversionsCount : 0),
      revenueCents: acc.revenueCents + (p.revenueCents > 0 ? p.revenueCents : 0),
    }),
    { clicks: 0, conversions: 0, revenueCents: 0 },
  )
  const isEmpty =
    !hasData ||
    (totals.clicks === 0 &&
      totals.conversions === 0 &&
      totals.revenueCents === 0)

  // Bar / marker scaling. Zero max means "no data" → flat 1px
  // placeholder bars (matches the partner EarningsChart pattern).
  const maxRevenue = safeSeries.reduce(
    (acc, p) => (p.revenueCents > acc ? p.revenueCents : acc),
    0,
  )
  const maxClicks = safeSeries.reduce(
    (acc, p) => (p.clicksCount > acc ? p.clicksCount : acc),
    0,
  )
  const maxConversions = safeSeries.reduce(
    (acc, p) => (p.conversionsCount > acc ? p.conversionsCount : acc),
    0,
  )

  const innerW = VIEWBOX_W - PADDING_X * 2
  const innerH = VIEWBOX_H - PADDING_TOP - PADDING_BOTTOM
  const barCount = Math.max(1, safeSeries.length)
  const slot = innerW / barCount
  const barWidth = Math.max(2, slot * 0.5)

  return (
    <section className={styles.card} aria-label="Performance">
      <header className={styles.header}>
        <p className={styles.eyebrow}>Performance</p>
        <h2 className={styles.h2}>Last {daysBack} days</h2>
        <p className={styles.subtle}>
          Calendar-aligned (UTC). Clicks + conversions on this
          affiliate&apos;s links; revenue from non-reversed commissions.
        </p>
      </header>

      {/* 3 headline tiles — pure markup, no client JS */}
      <div className={styles.kpis} data-empty={isEmpty ? 'true' : 'false'}>
        <article className={styles.tile} aria-label="Total clicks">
          <p className={styles.tileLabel}>Clicks</p>
          <p className={styles.tileValue}>
            {totals.clicks.toLocaleString('en-US')}
          </p>
        </article>
        <article
          className={styles.tile}
          aria-label="Total conversions"
        >
          <p className={styles.tileLabel}>Conversions</p>
          <p className={styles.tileValue}>
            {totals.conversions.toLocaleString('en-US')}
          </p>
          <p className={styles.tileSubtle}>
            {totals.clicks > 0
              ? `${((totals.conversions / totals.clicks) * 100).toFixed(1)}% of clicks`
              : '—'}
          </p>
        </article>
        <article className={styles.tile} aria-label="Total revenue">
          <p className={styles.tileLabel}>Revenue</p>
          <p className={styles.tileValue}>
            {formatMoney(totals.revenueCents, 'USD')}
          </p>
        </article>
      </div>

      {isEmpty ? (
        <p className={styles.empty}>
          No clicks or conversions in the last {daysBack} days.
        </p>
      ) : (
        <div className={styles.chartWrap}>
          <svg
            viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
            preserveAspectRatio="none"
            className={styles.svg}
            role="img"
            aria-label={`Performance chart of ${safeSeries.length} days`}
          >
            {/* Horizontal grid line — single thin reference at mid.
                Y axis is intentionally label-less for v1 (the bar
                peak implies scale). */}
            <line
              x1={PADDING_X}
              x2={VIEWBOX_W - PADDING_X}
              y1={PADDING_TOP + innerH / 2}
              y2={PADDING_TOP + innerH / 2}
              className={styles.gridLine}
            />

            {/* Revenue bars (primary metric) */}
            {safeSeries.map((p, i) => {
              const heightPx =
                maxRevenue > 0
                  ? (p.revenueCents / maxRevenue) * innerH
                  : 0
              const x = PADDING_X + i * slot + (slot - barWidth) / 2
              const y = PADDING_TOP + innerH - heightPx
              return (
                <rect
                  key={`bar-${p.day || i}-${i}`}
                  x={x}
                  y={y}
                  width={barWidth}
                  height={Math.max(0, heightPx)}
                  rx={2}
                  className={styles.bar}
                >
                  <title>{`${p.day}: ${formatMoney(p.revenueCents, 'USD')} (${p.conversionsCount} ${p.conversionsCount === 1 ? 'conversion' : 'conversions'}, ${p.clicksCount} ${p.clicksCount === 1 ? 'click' : 'clicks'})`}</title>
                </rect>
              )
            })}

            {/* Click markers (top edge of slot) — proportional to
                the max-clicks scale. Renders only when clicks > 0
                and maxClicks > 0. */}
            {maxClicks > 0 &&
              safeSeries.map((p, i) => {
                if (p.clicksCount <= 0) return null
                const ratio = p.clicksCount / maxClicks
                const cx = PADDING_X + i * slot + slot / 2
                const cy = PADDING_TOP + 6 + (1 - ratio) * 18
                return (
                  <circle
                    key={`click-${p.day || i}-${i}`}
                    cx={cx}
                    cy={cy}
                    r={2.5}
                    className={styles.clickDot}
                  >
                    <title>{`${p.day}: ${p.clicksCount} ${p.clicksCount === 1 ? 'click' : 'clicks'}`}</title>
                  </circle>
                )
              })}

            {/* Conversion markers (bottom edge of slot) — proportional
                to the max-conversions scale. */}
            {maxConversions > 0 &&
              safeSeries.map((p, i) => {
                if (p.conversionsCount <= 0) return null
                const ratio = p.conversionsCount / maxConversions
                const cx = PADDING_X + i * slot + slot / 2
                const cy =
                  PADDING_TOP + innerH - 6 - (1 - ratio) * 18
                return (
                  <rect
                    key={`conv-${p.day || i}-${i}`}
                    x={cx - 2}
                    y={cy - 2}
                    width={4}
                    height={4}
                    className={styles.convSquare}
                  >
                    <title>{`${p.day}: ${p.conversionsCount} ${p.conversionsCount === 1 ? 'conversion' : 'conversions'}`}</title>
                  </rect>
                )
              })}

            {/* X axis labels — first / mid / last */}
            {safeSeries.length > 0 && (
              <>
                <text
                  x={PADDING_X}
                  y={VIEWBOX_H - 8}
                  textAnchor="start"
                  className={styles.axisLabel}
                >
                  {dayLabel(safeSeries[0]!.day)}
                </text>
                {safeSeries.length > 1 && (
                  <text
                    x={PADDING_X + innerW / 2}
                    y={VIEWBOX_H - 8}
                    textAnchor="middle"
                    className={styles.axisLabel}
                  >
                    {dayLabel(
                      safeSeries[Math.floor(safeSeries.length / 2)]!.day,
                    )}
                  </text>
                )}
                {safeSeries.length > 2 && (
                  <text
                    x={VIEWBOX_W - PADDING_X}
                    y={VIEWBOX_H - 8}
                    textAnchor="end"
                    className={styles.axisLabel}
                  >
                    {dayLabel(safeSeries[safeSeries.length - 1]!.day)}
                  </text>
                )}
              </>
            )}
          </svg>

          {/* Legend — accessible to screen readers via inline copy +
              a visually-presented row. Reads as: bar = revenue, dot =
              clicks, square = conversions. */}
          <ul className={styles.legend} aria-label="Chart legend">
            <li className={styles.legendItem}>
              <span
                className={styles.legendSwatch}
                data-kind="revenue"
                aria-hidden="true"
              />
              <span>Revenue</span>
            </li>
            <li className={styles.legendItem}>
              <span
                className={styles.legendSwatch}
                data-kind="clicks"
                aria-hidden="true"
              />
              <span>Clicks</span>
            </li>
            <li className={styles.legendItem}>
              <span
                className={styles.legendSwatch}
                data-kind="conversions"
                aria-hidden="true"
              />
              <span>Conversions</span>
            </li>
          </ul>
        </div>
      )}
    </section>
  )
}
