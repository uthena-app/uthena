// DeviceBreakdownList.tsx — P13.7 device_class breakdown list.
//
// Renders the `AffiliateDeviceBreakdownRow[]` mapped by
// `getAffiliateDeviceBreakdown`. One row per device class with:
//   - Device label + 2-letter glyph (M / D / T / B / ?)
//   - Click count + share %
//   - A progress bar showing the share visually
//
// **Render strategy**: RSC, zero client JS. Pure markup.
//
// **Unknown semantics**: in v1 every click is in the 'Unknown'
// bucket (the click-track route that populates `device_class` is
// deferred to STUB-105 Slice 7). The component renders the
// Unknown bucket with a dim bar + a help caption so the affiliate
// understands why every click is "Unknown".

import type { AffiliateDeviceBreakdownRow } from '../queries/getAffiliateLinkAnalytics'
import styles from './DeviceBreakdownList.module.css'

/** Display label + glyph for each known device class. Unknown
 *  values render with a question mark + dim styling. */
const DEVICE_LABEL: Record<string, { label: string; glyph: string }> = {
  mobile: { label: 'Mobile', glyph: 'M' },
  desktop: { label: 'Desktop', glyph: 'D' },
  tablet: { label: 'Tablet', glyph: 'T' },
  bot: { label: 'Bot', glyph: 'B' },
  Unknown: { label: 'Unknown', glyph: '?' },
}

export function DeviceBreakdownList({
  rows,
  daysBack,
}: {
  rows: AffiliateDeviceBreakdownRow[]
  /** How many days back the breakdown represents. Used for the
   *  header caption + the empty-state copy. Defaults to the
   *  query's 30d default. */
  daysBack: number
}) {
  const safeRows = rows ?? []
  const totalClicks = safeRows.reduce((acc, r) => acc + r.clicksCount, 0)
  const isEmpty = totalClicks === 0

  const sorted = [...safeRows].sort((a, b) => b.clicksCount - a.clicksCount)
  const isAllUnknown =
    sorted.length > 0 &&
    sorted.every((r) => r.deviceClass === 'Unknown')

  return (
    <section className={styles.card} aria-label="Device breakdown">
      <div className={styles.header}>
        <p className={styles.eyebrow}>Devices</p>
        <h3 className={styles.h3}>Device mix — last {daysBack} days</h3>
        <p className={styles.subtle}>
          Click origin by device class (mobile / desktop / tablet / bot).
        </p>
      </div>

      {isEmpty ? (
        <p className={styles.empty}>
          No clicks in the last {daysBack} days. Share your link to start
          the clock.
        </p>
      ) : (
        <>
          <ul className={styles.list}>
            {sorted.map((row) => (
              <DeviceRow
                key={row.deviceClass}
                row={row}
                totalClicks={totalClicks}
              />
            ))}
          </ul>

          {isAllUnknown && (
            <p className={styles.help}>
              Every click is showing as <strong>Unknown</strong> because the
              click-track route&apos;s UA-classifier hasn&apos;t been wired yet
              (tracked in the migration 0049 stub register). Once the
              /api/affiliate/click endpoint starts classifying user agents,
              this list will fill in automatically.
            </p>
          )}
        </>
      )}
    </section>
  )
}

function DeviceRow({
  row,
  totalClicks,
}: {
  row: AffiliateDeviceBreakdownRow
  totalClicks: number
}) {
  const meta = DEVICE_LABEL[row.deviceClass] ?? DEVICE_LABEL.Unknown!
  const isUnknown = row.deviceClass === 'Unknown'
  const sharePct =
    row.sharePct ??
    (totalClicks > 0
      ? Math.round((row.clicksCount * 10000) / totalClicks) / 100
      : 0)
  const barWidthPct = Math.max(0, Math.min(100, sharePct))
  return (
    <li className={styles.row} data-device={row.deviceClass}>
      <span
        className={`${styles.device} ${isUnknown ? styles.deviceDim : ''}`}
      >
        <span className={styles.deviceIcon} aria-hidden="true">
          {meta.glyph}
        </span>
        {meta.label}
      </span>
      <div className={styles.barWrap} aria-hidden="true">
        <div
          className={styles.barFill}
          data-state={isUnknown ? 'unknown' : undefined}
          style={{ width: `${barWidthPct}%` }}
        />
      </div>
      <span className={styles.share}>
        {sharePct.toFixed(1)}%
        <br />
        <span className={styles.clicks}>
          {row.clicksCount.toLocaleString('en-US')}{' '}
          {row.clicksCount === 1 ? 'click' : 'clicks'}
        </span>
      </span>
    </li>
  )
}