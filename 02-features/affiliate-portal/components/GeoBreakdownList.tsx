// GeoBreakdownList.tsx — P13.7 country breakdown list.
//
// Renders the `AffiliateGeoBreakdownRow[]` mapped by
// `getAffiliateGeoBreakdown`. One row per country (or the
// literal 'Unknown' bucket) with:
//   - Country code or label
//   - Click count + share %
//   - A progress bar showing the share visually
//
// **Render strategy**: RSC, zero client JS. Pure markup.
//
// **Unknown semantics**: in v1 every click is in the 'Unknown'
// bucket (the click-track route that populates `country` is
// deferred to STUB-105 Slice 7). The component renders the
// Unknown bucket with a dim bar + a help caption so the affiliate
// understands why every click is "Unknown".
//
// **Top-N truncation**: with 250+ country codes the list could be
// very long. The component caps at TOP_N (10) and folds the rest
// into an "Other" bucket so the list is always ≤ TOP_N + 1 rows.

import type { AffiliateGeoBreakdownRow } from '../queries/getAffiliateLinkAnalytics'
import styles from './GeoBreakdownList.module.css'

const TOP_N = 10

/** Best-effort mapping from ISO country code → human-readable
 *  name. Falls back to the raw code if the code is not in the
 *  common list (defensive — the codes in v1 may include 'Unknown'
 *  which we render explicitly). */
const COUNTRY_NAMES: Record<string, string> = {
  US: 'United States',
  CA: 'Canada',
  GB: 'United Kingdom',
  AU: 'Australia',
  DE: 'Germany',
  FR: 'France',
  ES: 'Spain',
  IT: 'Italy',
  NL: 'Netherlands',
  BE: 'Belgium',
  SE: 'Sweden',
  NO: 'Norway',
  DK: 'Denmark',
  FI: 'Finland',
  IE: 'Ireland',
  PT: 'Portugal',
  AT: 'Austria',
  CH: 'Switzerland',
  PL: 'Poland',
  BR: 'Brazil',
  MX: 'Mexico',
  AR: 'Argentina',
  IN: 'India',
  JP: 'Japan',
  KR: 'South Korea',
  CN: 'China',
  HK: 'Hong Kong',
  SG: 'Singapore',
  NZ: 'New Zealand',
  ZA: 'South Africa',
  AE: 'United Arab Emirates',
  IL: 'Israel',
  TR: 'Turkey',
  RU: 'Russia',
  TH: 'Thailand',
  VN: 'Vietnam',
  ID: 'Indonesia',
  MY: 'Malaysia',
  PH: 'Philippines',
  EG: 'Egypt',
  NG: 'Nigeria',
  KE: 'Kenya',
}

function countryDisplay(code: string): string {
  if (code === 'Unknown') return 'Unknown'
  const upper = code.toUpperCase()
  const name = COUNTRY_NAMES[upper]
  return name ? `${name} (${upper})` : upper
}

export function GeoBreakdownList({
  rows,
  daysBack,
}: {
  rows: AffiliateGeoBreakdownRow[]
  /** How many days back the breakdown represents. Used for the
   *  header caption + the empty-state copy. Defaults to the
   *  query's 30d default. */
  daysBack: number
}) {
  const safeRows = rows ?? []
  const totalClicks = safeRows.reduce((acc, r) => acc + r.clicksCount, 0)
  const isEmpty = totalClicks === 0

  // Identify the Unknown bucket row (may not exist if the RPC
  // returned zero rows for it — defensive).
  const unknownRow = safeRows.find((r) => r.country === 'Unknown')
  const isAllUnknown =
    safeRows.length > 0 &&
    safeRows.every((r) => r.country === 'Unknown')

  // Top N + "Other" bucket. The "Other" row collapses the
  // remaining countries into a single aggregate so the list is
  // bounded. We skip this when the list is already small
  // (≤ TOP_N rows) — the explicit "Other" row would be empty.
  const sorted = [...safeRows].sort((a, b) => b.clicksCount - a.clicksCount)
  const knownTop = sorted
    .filter((r) => r.country !== 'Unknown')
    .slice(0, TOP_N)
  const knownOverflow = sorted
    .filter((r) => r.country !== 'Unknown')
    .slice(TOP_N)
  const overflowClicks = knownOverflow.reduce(
    (acc, r) => acc + r.clicksCount,
    0,
  )
  const overflowShare =
    totalClicks > 0
      ? Math.round((overflowClicks * 10000) / totalClicks) / 100
      : null

  return (
    <section className={styles.card} aria-label="Country breakdown">
      <div className={styles.header}>
        <p className={styles.eyebrow}>Geography</p>
        <h3 className={styles.h3}>Top countries — last {daysBack} days</h3>
        <p className={styles.subtle}>
          Click origin by ISO 3166-1 country code.
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
            {knownTop.map((row) => (
              <GeoRow key={row.country} row={row} totalClicks={totalClicks} />
            ))}
            {knownOverflow.length > 0 && overflowClicks > 0 && (
              <GeoOverflowRow
                overflowCount={knownOverflow.length}
                clicks={overflowClicks}
                sharePct={overflowShare}
              />
            )}
            {unknownRow && (
              <GeoRow row={unknownRow} totalClicks={totalClicks} />
            )}
          </ul>

          {isAllUnknown && (
            <p className={styles.help} data-tone={isAllUnknown ? 'warn' : undefined}>
              Every click is showing as <strong>Unknown</strong> because the
              click-track route&apos;s geo enrichment hasn&apos;t been wired yet
              (tracked in the migration 0049 stub register). Once the
              /api/affiliate/click endpoint starts calling the IP→country
              helper, this list will fill in automatically.
            </p>
          )}
        </>
      )}
    </section>
  )
}

function GeoRow({
  row,
  totalClicks,
}: {
  row: AffiliateGeoBreakdownRow
  totalClicks: number
}) {
  const isUnknown = row.country === 'Unknown'
  const sharePct =
    row.sharePct ??
    (totalClicks > 0
      ? Math.round((row.clicksCount * 10000) / totalClicks) / 100
      : 0)
  const barWidthPct = Math.max(0, Math.min(100, sharePct))
  return (
    <li className={styles.row} data-country={row.country}>
      <span
        className={`${styles.country} ${isUnknown ? styles.countryDim : ''}`}
      >
        {countryDisplay(row.country)}
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

function GeoOverflowRow({
  overflowCount,
  clicks,
  sharePct,
}: {
  overflowCount: number
  clicks: number
  sharePct: number | null
}) {
  const barWidthPct =
    sharePct == null ? 0 : Math.max(0, Math.min(100, sharePct))
  return (
    <li className={styles.row} data-country="__overflow__">
      <span className={`${styles.country} ${styles.countryDim}`}>
        Other ({overflowCount})
      </span>
      <div className={styles.barWrap} aria-hidden="true">
        <div
          className={styles.barFill}
          style={{ width: `${barWidthPct}%` }}
        />
      </div>
      <span className={styles.share}>
        {(sharePct ?? 0).toFixed(1)}%
        <br />
        <span className={styles.clicks}>
          {clicks.toLocaleString('en-US')}{' '}
          {clicks === 1 ? 'click' : 'clicks'}
        </span>
      </span>
    </li>
  )
}