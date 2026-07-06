// HourlyClicksChart.tsx — P13.7 per-hour click chart.
//
// Inline SVG, RSC, zero client JS. Reads the
// `AffiliateHourlyClicksPoint[]` mapped by `getAffiliateHourlyClicks`
// and renders a 24h bar chart with:
//   - 1 bar per hour (24 buckets when hoursBack=24)
//   - X axis labels at every 6th hour (00:00, 06:00, 12:00, 18:00)
//     — same density pattern as PerformanceChart's first/mid/last
//   - Peak bucket highlighted with the `--accent` token; the rest
//     use `--teal` (the standard affiliate accent)
//   - Headline total clicks in the header (matches PerformanceChart's
//     KPI tile rhythm)
//   - "Peak hour" callout below the chart when one bucket dominates
//   - Empty state when the entire window has 0 clicks
//
// **Render strategy**: RSC, no hover tooltips, no zoom. The chart
// is a visual rendering. The hourly bucket is sufficient for "what
// time of day do my clicks come in?" — the affiliate sees the shape
// and drills into specific links via the AllLinksTable's per-link
// columns.

import type { AffiliateHourlyClicksPoint } from '../queries/getAffiliateLinkAnalytics'
import styles from './HourlyClicksChart.module.css'

const VIEWBOX_W = 720
const VIEWBOX_H = 160
const PADDING_X = 16
const PADDING_TOP = 18
const PADDING_BOTTOM = 28

/** Format a UTC hour-of-day number as `HH:00`. Negative / out-of-
 *  range values fall back to the empty string. */
function hourLabel(h: number): string {
  if (!Number.isFinite(h) || h < 0 || h > 23) return ''
  return `${String(Math.trunc(h)).padStart(2, '0')}:00`
}

/** Extract the UTC hour-of-day from a bucket_start ISO string. */
function bucketHour(iso: string): number {
  if (!iso) return -1
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return -1
  return t.getUTCHours()
}

/** Format a clock time from a bucket_start ISO string (HH:00). */
function bucketLabel(iso: string): string {
  return hourLabel(bucketHour(iso))
}

export function HourlyClicksChart({
  series,
  hoursBack,
}: {
  series: AffiliateHourlyClicksPoint[]
  /** How many hours back the series represents. Used for the header
   *  caption + the empty-state copy. Defaults to the query's 24h
   *  default. */
  hoursBack: number
}) {
  const safeSeries = series ?? []
  const hasData = safeSeries.length > 0

  const totals = safeSeries.reduce(
    (acc, p) => acc + (p.clicksCount > 0 ? p.clicksCount : 0),
    0,
  )
  const isEmpty = !hasData || totals === 0

  // Find the peak bucket (clicks > 0). When several buckets tie, the
  // first wins — keeps the chart's "peak hour" callout deterministic.
  let peakIndex = -1
  let peakCount = 0
  safeSeries.forEach((p, i) => {
    if (p.clicksCount > peakCount) {
      peakCount = p.clicksCount
      peakIndex = i
    }
  })

  // Bar scaling. When max is 0 the chart renders 1px placeholder
  // bars (matches PerformanceChart's zero-max pattern).
  const maxClicks = safeSeries.reduce(
    (acc, p) => (p.clicksCount > acc ? p.clicksCount : acc),
    0,
  )

  const innerW = VIEWBOX_W - PADDING_X * 2
  const innerH = VIEWBOX_H - PADDING_TOP - PADDING_BOTTOM
  const barCount = Math.max(1, safeSeries.length)
  const slot = innerW / barCount
  const barWidth = Math.max(2, slot * 0.6)

  return (
    <section className={styles.card} aria-label="Per-hour clicks">
      <div className={styles.headerRow}>
        <div>
          <p className={styles.eyebrow}>Click cadence</p>
          <h3 className={styles.h3}>Last {hoursBack} hours</h3>
          <p className={styles.subtle}>
            UTC-aligned hour buckets. Peak hour highlighted in accent.
          </p>
        </div>
        <div className={styles.totalWrap}>
          <p className={styles.totalLabel}>Clicks</p>
          <p className={styles.totalValue}>{totals.toLocaleString('en-US')}</p>
        </div>
      </div>

      {isEmpty ? (
        <p className={styles.empty}>
          No clicks in the last {hoursBack} hours. Share your link to start
          the clock.
        </p>
      ) : (
        <>
          <div className={styles.chartWrap}>
            <svg
              viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
              preserveAspectRatio="none"
              className={styles.svg}
              role="img"
              aria-label={`Per-hour clicks chart of ${safeSeries.length} hours`}
            >
              {/* Mid-height grid reference line. */}
              <line
                x1={PADDING_X}
                x2={VIEWBOX_W - PADDING_X}
                y1={PADDING_TOP + innerH / 2}
                y2={PADDING_TOP + innerH / 2}
                className={styles.gridLine}
              />

              {/* Hour bars. */}
              {safeSeries.map((p, i) => {
                const heightPx =
                  maxClicks > 0 ? (p.clicksCount / maxClicks) * innerH : 0
                const x = PADDING_X + i * slot + (slot - barWidth) / 2
                const y = PADDING_TOP + innerH - heightPx
                const isPeak = i === peakIndex && peakCount > 0
                return (
                  <rect
                    key={`hb-${i}-${p.bucketStart || 'unknown'}`}
                    x={x}
                    y={y}
                    width={barWidth}
                    height={Math.max(0, heightPx)}
                    rx={2}
                    className={styles.bar}
                    data-emphasis={isPeak ? 'peak' : undefined}
                  >
                    <title>{`${bucketLabel(p.bucketStart) || `#${i + 1}`}: ${p.clicksCount.toLocaleString('en-US')} ${p.clicksCount === 1 ? 'click' : 'clicks'}`}</title>
                  </rect>
                )
              })}

              {/* X axis labels — every 6th hour (00:00 / 06:00 /
                  12:00 / 18:00). Matches the X axis density of the
                  PerformanceChart. */}
              {safeSeries.map((p, i) => {
                const h = bucketHour(p.bucketStart)
                if (h !== 0 && h !== 6 && h !== 12 && h !== 18) return null
                const cx = PADDING_X + i * slot + slot / 2
                return (
                  <text
                    key={`xl-${i}`}
                    x={cx}
                    y={VIEWBOX_H - 8}
                    textAnchor="middle"
                    className={styles.axisLabel}
                  >
                    {hourLabel(h)}
                  </text>
                )
              })}
            </svg>

            {/* Legend */}
            <ul className={styles.legendRow} aria-label="Chart legend">
              <li className={styles.legendItem}>
                <span className={styles.legendSwatch} aria-hidden="true" />
                <span>Clicks</span>
              </li>
              <li className={styles.legendItem}>
                <span
                  className={styles.legendSwatch}
                  data-kind="peak"
                  aria-hidden="true"
                />
                <span>Peak hour</span>
              </li>
            </ul>
          </div>

          {peakIndex >= 0 && peakCount > 0 && (
            <p className={styles.peak}>
              <span className={styles.peakStrong}>Peak hour:</span>{' '}
              {bucketLabel(safeSeries[peakIndex]!.bucketStart) || `#${peakIndex + 1}`}{' '}
              with {peakCount.toLocaleString('en-US')}{' '}
              {peakCount === 1 ? 'click' : 'clicks'}.
            </p>
          )}
        </>
      )}
    </section>
  )
}