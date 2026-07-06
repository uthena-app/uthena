// LinksStatsRow.test.tsx — P13.5 stats row unit tests.
//
// Pure render via react-dom/server. Verifies:
//   - 4 stat tiles render with the right labels
//   - Zero totals render as "0"
//   - Non-zero totals render formatted (comma-grouped)
//   - No-data state shows the "—" placeholder for conversion rate
//   - Heading aria-label is "Link performance totals"

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { LinksStatsRow } from './LinksStatsRow'
import type { AffiliateLinksStats } from '../queries/getMyAffiliateLinks'
import type { ReactElement } from 'react'

function render(el: ReactElement) {
  return renderToStaticMarkup(el)
}

const ZERO_STATS: AffiliateLinksStats = {
  totalLinks: 0,
  totalClicks30d: 0,
  totalConversions30d: 0,
  avgConversionRate30d: null,
}

const LIVE_STATS: AffiliateLinksStats = {
  totalLinks: 1,
  totalClicks30d: 1245,
  totalConversions30d: 62,
  avgConversionRate30d: 62 / 1245,
}

describe('LinksStatsRow — empty state', () => {
  it('renders 4 tiles in the zero-data state', () => {
    const html = render(<LinksStatsRow stats={ZERO_STATS} />)
    // Labels
    expect(html).toContain('Total links')
    expect(html).toContain('Clicks (30d)')
    expect(html).toContain('Conversions (30d)')
    expect(html).toContain('Conversion rate (30d)')
  })

  it('shows "—" for the conversion rate when there are no clicks', () => {
    const html = render(<LinksStatsRow stats={ZERO_STATS} />)
    expect(html).toContain('—')
    // The "—" placeholder is rendered in a span with the muted class
    // (matches the data-empty=true attribute on the section).
    expect(html).toContain('data-empty="true"')
  })

  it('shows "0" for the totals when there is no activity', () => {
    const html = render(<LinksStatsRow stats={ZERO_STATS} />)
    // The conversion-rate tile is the only one that doesn't show "0"
    // (it shows "—" instead). All other tiles render "0".
    expect(html).toContain('>0<')
  })
})

describe('LinksStatsRow — populated state', () => {
  it('formats numbers with the en-US locale (comma-grouped)', () => {
    const html = render(<LinksStatsRow stats={LIVE_STATS} />)
    expect(html).toContain('1,245')
    expect(html).toContain('62')
  })

  it('renders the conversion rate as a percent', () => {
    const html = render(<LinksStatsRow stats={LIVE_STATS} />)
    // 62/1245 ~= 4.979% → "5.0%"
    expect(html).toContain('5.0%')
  })

  it('renders the conversion rate as integer percent when the value is whole', () => {
    const html = render(
      <LinksStatsRow
        stats={{
          totalLinks: 1,
          totalClicks30d: 100,
          totalConversions30d: 25,
          avgConversionRate30d: 0.25,
        }}
      />,
    )
    expect(html).toContain('25%')
  })

  it('renders the conversion rate as integer percent when the value >= 100', () => {
    const html = render(
      <LinksStatsRow
        stats={{
          totalLinks: 2,
          totalClicks30d: 50,
          totalConversions30d: 60,
          avgConversionRate30d: 1.2,
        }}
      />,
    )
    // 60/50 = 1.2 → 120% (rounded)
    expect(html).toContain('120%')
  })

  it('marks the conversion-rate tile as data-state="live" when clicks > 0', () => {
    const html = render(<LinksStatsRow stats={LIVE_STATS} />)
    expect(html).toContain('data-state="live"')
  })

  it('marks the section data-empty="false" when there is activity', () => {
    const html = render(<LinksStatsRow stats={LIVE_STATS} />)
    expect(html).toContain('data-empty="false"')
  })

  it('uses the "Active link" singular copy when totalLinks === 1', () => {
    const html = render(<LinksStatsRow stats={LIVE_STATS} />)
    expect(html).toContain('Active link')
  })

  it('uses the "Active links" plural copy when totalLinks > 1', () => {
    const html = render(
      <LinksStatsRow
        stats={{
          ...LIVE_STATS,
          totalLinks: 7,
        }}
      />,
    )
    expect(html).toContain('Active links')
  })
})

describe('LinksStatsRow — accessibility', () => {
  it('renders a section with aria-label="Link performance totals"', () => {
    const html = render(<LinksStatsRow stats={LIVE_STATS} />)
    expect(html).toContain('aria-label="Link performance totals"')
  })

  it('renders per-tile aria-labels for screen reader semantics', () => {
    const html = render(<LinksStatsRow stats={LIVE_STATS} />)
    expect(html).toContain('aria-label="Total links"')
    expect(html).toContain('aria-label="Total clicks in last 30 days"')
    expect(html).toContain('aria-label="Total conversions in last 30 days"')
    expect(html).toContain('aria-label="Average conversion rate in last 30 days"')
  })
})
