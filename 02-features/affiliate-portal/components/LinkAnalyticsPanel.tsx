// LinkAnalyticsPanel.tsx — P13.7 link analytics orchestrator.
//
// Pure server component (RSC) that reads the 3 RPC results in
// parallel via Promise.all and composes the 3 sub-components:
//   - <HourlyClicksChart>     — 24h bar chart
//   - <GeoBreakdownList>      — top countries
//   - <DeviceBreakdownList>   — device_class breakdown
//
// The orchestrator owns no state; each sub-component is fully
// self-contained. The grid layout puts geo + device side-by-side
// on desktop and stacks on ≤1024px.

import {
  getAffiliateHourlyClicks,
  getAffiliateGeoBreakdown,
  getAffiliateDeviceBreakdown,
} from '../queries/getAffiliateLinkAnalytics'
import { HourlyClicksChart } from './HourlyClicksChart'
import { GeoBreakdownList } from './GeoBreakdownList'
import { DeviceBreakdownList } from './DeviceBreakdownList'
import styles from './LinkAnalyticsPanel.module.css'

const DEFAULT_HOURS_BACK = 24
const DEFAULT_DAYS_BACK = 30

export async function LinkAnalyticsPanel() {
  // Round 1 (parallel): the 3 RPC reads. Each is independently
  // fail-soft — anon / non-affiliate / RPC error → empty array.
  // The 3 sub-components each render their own empty state so a
  // single failure doesn't blank the whole panel.
  const [hourly, geo, device] = await Promise.all([
    getAffiliateHourlyClicks({ hoursBack: DEFAULT_HOURS_BACK }),
    getAffiliateGeoBreakdown({ daysBack: DEFAULT_DAYS_BACK }),
    getAffiliateDeviceBreakdown({ daysBack: DEFAULT_DAYS_BACK }),
  ])

  return (
    <section className={styles.panel} aria-label="Link analytics">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Link analytics</p>
          <h2 className={styles.h2}>How your links are performing</h2>
          <p className={styles.lede}>
            Per-hour click cadence + top countries + device mix for your
            affiliate links. The hourly chart refreshes live; the country
            and device windows cover the last {DEFAULT_DAYS_BACK} days.
          </p>
        </div>
      </header>

      <HourlyClicksChart
        series={hourly}
        hoursBack={DEFAULT_HOURS_BACK}
      />

      <div className={styles.grid}>
        <GeoBreakdownList rows={geo} daysBack={DEFAULT_DAYS_BACK} />
        <DeviceBreakdownList rows={device} daysBack={DEFAULT_DAYS_BACK} />
      </div>
    </section>
  )
}