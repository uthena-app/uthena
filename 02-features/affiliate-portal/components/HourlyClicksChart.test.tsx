// HourlyClicksChart.test.tsx — P13.7 per-hour click chart rendering.
//
// Pure component test via react-dom/server `renderToStaticMarkup`.
// Verifies:
//   - Headline total clicks in the header
//   - Title + "Last N hours" copy
//   - Empty-state message when the series has no data
//   - SVG renders the bars + peak emphasis + axis labels when data
//     exists
//   - Peak hour callout identifies the correct bucket
//   - Defensive narrowing (null series, malformed bucket_start)

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { HourlyClicksChart } from './HourlyClicksChart'
import type { AffiliateHourlyClicksPoint } from '../queries/getAffiliateLinkAnalytics'
import type { ReactElement } from 'react'

function render(el: ReactElement) {
  return renderToStaticMarkup(el)
}

/** Build N hourly buckets ending now. The first bucket (index 0) is
 *  the OLDEST (clicksCount = 0), the last (index N-1) is the NEWEST
 *  (clicksCount = N-1). Mirrors the test pattern in
 *  getAffiliateLinkAnalytics.test.ts. */
function makeSeries(n: number, multiplier = 1): AffiliateHourlyClicksPoint[] {
  const now = Date.now()
  return Array.from({ length: n }, (_, i) => ({
    bucketStart: new Date(now - i * 3600_000).toISOString(),
    clicksCount: i * multiplier,
  })).reverse()
}

describe('HourlyClicksChart — headline total', () => {
  it('aggregates the total click count correctly', () => {
    const series = makeSeries(24)
    const html = render(<HourlyClicksChart series={series} hoursBack={24} />)
    // Sum of 0..23 = 276
    expect(html).toContain('276')
  })

  it('renders the "Clicks" label', () => {
    const series = makeSeries(24)
    const html = render(<HourlyClicksChart series={series} hoursBack={24} />)
    expect(html).toContain('Clicks')
  })
})

describe('HourlyClicksChart — title + structure', () => {
  it('renders the title + "Last N hours" subtitle', () => {
    const series = makeSeries(24)
    const html = render(<HourlyClicksChart series={series} hoursBack={24} />)
    expect(html).toContain('Last 24 hours')
    expect(html).toContain('Click cadence')
  })

  it('honors the custom hoursBack value in the heading', () => {
    const series = makeSeries(48)
    const html = render(<HourlyClicksChart series={series} hoursBack={48} />)
    expect(html).toContain('Last 48 hours')
  })
})

describe('HourlyClicksChart — empty state', () => {
  it('shows the empty-state message when the series is empty', () => {
    const html = render(<HourlyClicksChart series={[]} hoursBack={24} />)
    expect(html).toContain('No clicks in the last 24 hours.')
    expect(html).not.toContain('<svg')
  })

  it('shows the empty-state message when all buckets are zero', () => {
    const zeros = makeSeries(24, 0)
    const html = render(<HourlyClicksChart series={zeros} hoursBack={24} />)
    expect(html).toContain('No clicks in the last 24 hours.')
  })

  it('uses the hoursBack value in the empty state', () => {
    const html = render(<HourlyClicksChart series={[]} hoursBack={48} />)
    expect(html).toContain('No clicks in the last 48 hours.')
  })
})

describe('HourlyClicksChart — chart SVG + bars', () => {
  it('renders the inline SVG with the correct viewBox + role', () => {
    const series = makeSeries(24)
    const html = render(<HourlyClicksChart series={series} hoursBack={24} />)
    expect(html).toContain('<svg')
    expect(html).toContain('viewBox="0 0 720 160"')
    expect(html).toContain('role="img"')
  })

  it('renders one <rect> per hour bucket', () => {
    const series = makeSeries(24)
    const html = render(<HourlyClicksChart series={series} hoursBack={24} />)
    // 24 bars (rx="2" with no data-emphasis on most)
    const bars = html.match(/<rect[^>]*rx="2"/g) ?? []
    expect(bars.length).toBe(24)
  })

  it('marks the peak bucket with data-emphasis="peak"', () => {
    const series = makeSeries(24)
    const html = render(<HourlyClicksChart series={series} hoursBack={24} />)
    // Exactly one bar should carry the peak emphasis
    const peaks = html.match(/data-emphasis="peak"/g) ?? []
    expect(peaks.length).toBe(1)
  })

  it('renders X axis labels at 00:00 / 06:00 / 12:00 / 18:00', () => {
    const series = makeSeries(24)
    const html = render(<HourlyClicksChart series={series} hoursBack={24} />)
    expect(html).toContain('>00:00<')
    expect(html).toContain('>06:00<')
    expect(html).toContain('>12:00<')
    expect(html).toContain('>18:00<')
  })
})

describe('HourlyClicksChart — peak hour callout', () => {
  it('identifies the peak hour correctly', () => {
    const series = makeSeries(24, 5)
    const html = render(<HourlyClicksChart series={series} hoursBack={24} />)
    expect(html).toContain('Peak hour:')
    // 23 * 5 = 115 clicks → at the bucket labeled with the hour
    // corresponding to the NEWEST bucket (i=0 → now).
    expect(html).toMatch(/115\s+clicks/)
  })

  it('uses the singular "click" for 1-click peaks', () => {
    const series: AffiliateHourlyClicksPoint[] = Array.from(
      { length: 24 },
      (_, i) => ({
        bucketStart: new Date(Date.now() - i * 3600_000).toISOString(),
        // All zeros except index 23 (oldest) which is 1
        clicksCount: i === 23 ? 1 : 0,
      }),
    ).reverse()
    const html = render(<HourlyClicksChart series={series} hoursBack={24} />)
    expect(html).toMatch(/\b1\s+click\b/)
  })
})

describe('HourlyClicksChart — defensive narrowing', () => {
  it('tolerates a null series prop', () => {
    const html = render(
      <HourlyClicksChart
        series={null as unknown as AffiliateHourlyClicksPoint[]}
        hoursBack={24}
      />,
    )
    expect(html).toContain('No clicks in the last 24 hours.')
  })

  it('renders without throwing when bucket_start is malformed', () => {
    const bad: AffiliateHourlyClicksPoint[] = [
      { bucketStart: '', clicksCount: 5 },
      { bucketStart: 'not-a-date', clicksCount: 3 },
    ]
    const html = render(<HourlyClicksChart series={bad} hoursBack={2} />)
    expect(html).toContain('Click cadence')
    // No throw; the chart renders
  })
})