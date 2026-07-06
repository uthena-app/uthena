// GeoBreakdownList.test.tsx — P13.7 country breakdown list rendering.
//
// Pure component test via react-dom/server `renderToStaticMarkup`.
// Verifies:
//   - Header + "Top countries — last N days" copy
//   - One <li> per row with country code + share % + click count
//   - Top-N truncation + "Other" bucket
//   - Empty-state message
//   - "Unknown" bucket help caption when all rows are Unknown
//   - Country name lookup (US → "United States (US)")

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { GeoBreakdownList } from './GeoBreakdownList'
import type { AffiliateGeoBreakdownRow } from '../queries/getAffiliateLinkAnalytics'
import type { ReactElement } from 'react'

function render(el: ReactElement) {
  return renderToStaticMarkup(el)
}

describe('GeoBreakdownList — title + structure', () => {
  it('renders the title + "Top countries — last N days" copy', () => {
    const html = render(<GeoBreakdownList rows={[]} daysBack={30} />)
    expect(html).toContain('Top countries — last 30 days')
    expect(html).toContain('Geography')
  })

  it('honors the custom daysBack value', () => {
    const html = render(<GeoBreakdownList rows={[]} daysBack={14} />)
    expect(html).toContain('Top countries — last 14 days')
  })
})

describe('GeoBreakdownList — empty state', () => {
  it('shows the empty-state message when rows are empty', () => {
    const html = render(<GeoBreakdownList rows={[]} daysBack={30} />)
    expect(html).toContain('No clicks in the last 30 days.')
  })

  it('uses the daysBack value in the empty state', () => {
    const html = render(<GeoBreakdownList rows={[]} daysBack={7} />)
    expect(html).toContain('No clicks in the last 7 days.')
  })
})

describe('GeoBreakdownList — happy path', () => {
  it('renders one row per country with share % + click count', () => {
    const rows: AffiliateGeoBreakdownRow[] = [
      { country: 'US', clicksCount: 120, sharePct: 60 },
      { country: 'CA', clicksCount: 50,  sharePct: 25 },
      { country: 'GB', clicksCount: 30,  sharePct: 15 },
    ]
    const html = render(<GeoBreakdownList rows={rows} daysBack={30} />)
    // 3 <li> with data-country attributes
    expect((html.match(/data-country="/g) ?? []).length).toBe(3)
    expect(html).toContain('data-country="US"')
    expect(html).toContain('data-country="CA"')
    expect(html).toContain('data-country="GB"')
    // Share %s render
    expect(html).toContain('60.0%')
    expect(html).toContain('25.0%')
    expect(html).toContain('15.0%')
    // Click counts render
    expect(html).toContain('120')
    expect(html).toContain('50')
    expect(html).toContain('30')
  })

  it('uses the country name lookup for known codes (US → United States)', () => {
    const rows: AffiliateGeoBreakdownRow[] = [
      { country: 'US', clicksCount: 10, sharePct: 100 },
    ]
    const html = render(<GeoBreakdownList rows={rows} daysBack={30} />)
    expect(html).toContain('United States (US)')
  })

  it('falls back to the raw code for unknown codes', () => {
    const rows: AffiliateGeoBreakdownRow[] = [
      { country: 'XX', clicksCount: 10, sharePct: 100 },
    ]
    const html = render(<GeoBreakdownList rows={rows} daysBack={30} />)
    expect(html).toContain('XX')
    // No parenthetical country name for unknown codes
    expect(html).not.toContain('United Nations')
  })

  it('uses the singular "click" for 1-click rows', () => {
    const rows: AffiliateGeoBreakdownRow[] = [
      { country: 'US', clicksCount: 1, sharePct: 100 },
    ]
    const html = render(<GeoBreakdownList rows={rows} daysBack={30} />)
    expect(html).toMatch(/\b1\s+click\b/)
  })

  it('uses the plural "clicks" for 2+ rows', () => {
    const rows: AffiliateGeoBreakdownRow[] = [
      { country: 'US', clicksCount: 2, sharePct: 100 },
    ]
    const html = render(<GeoBreakdownList rows={rows} daysBack={30} />)
    expect(html).toMatch(/\b2\s+clicks\b/)
  })
})

describe('GeoBreakdownList — top-N truncation', () => {
  it('shows the top 10 countries + an "Other" overflow bucket', () => {
    const rows: AffiliateGeoBreakdownRow[] = Array.from(
      { length: 15 },
      (_, i) => ({
        country: `C${i.toString().padStart(2, '0')}`,
        clicksCount: 100 - i,
        sharePct: 10 - i * 0.5,
      }),
    )
    const html = render(<GeoBreakdownList rows={rows} daysBack={30} />)
    // Top 10 country rows
    expect((html.match(/data-country="C[0-9]{2}"/g) ?? []).length).toBe(10)
    // The "Other" bucket row
    expect(html).toContain('data-country="__overflow__"')
    expect(html).toContain('Other (5)')
  })

  it('does not show the "Other" bucket when there are ≤ 10 countries', () => {
    const rows: AffiliateGeoBreakdownRow[] = Array.from(
      { length: 5 },
      (_, i) => ({
        country: `C${i.toString().padStart(2, '0')}`,
        clicksCount: 100 - i,
        sharePct: 20 - i * 4,
      }),
    )
    const html = render(<GeoBreakdownList rows={rows} daysBack={30} />)
    expect(html).not.toContain('data-country="__overflow__"')
    expect(html).not.toContain('Other (')
  })
})

describe('GeoBreakdownList — Unknown bucket', () => {
  it('renders the help caption when every row is Unknown', () => {
    const rows: AffiliateGeoBreakdownRow[] = [
      { country: 'Unknown', clicksCount: 100, sharePct: 100 },
    ]
    const html = render(<GeoBreakdownList rows={rows} daysBack={30} />)
    expect(html).toContain('Unknown')
    expect(html).toContain('geo enrichment')
    // HTML entity for apostrophe — `hasn&#x27;t` is the rendered form
    expect(html).toMatch(/hasn(?:'|&#x27;)t been wired yet/)
  })

  it('does not render the help caption when there are known countries', () => {
    const rows: AffiliateGeoBreakdownRow[] = [
      { country: 'US',     clicksCount: 100, sharePct: 50 },
      { country: 'Unknown', clicksCount: 100, sharePct: 50 },
    ]
    const html = render(<GeoBreakdownList rows={rows} daysBack={30} />)
    expect(html).not.toMatch(/hasn(?:'|&#x27;)t been wired yet/)
  })

  it('renders the Unknown bucket as a regular row when mixed with known', () => {
    const rows: AffiliateGeoBreakdownRow[] = [
      { country: 'US',     clicksCount: 100, sharePct: 50 },
      { country: 'Unknown', clicksCount: 100, sharePct: 50 },
    ]
    const html = render(<GeoBreakdownList rows={rows} daysBack={30} />)
    expect(html).toContain('data-country="Unknown"')
    expect(html).toContain('data-state="unknown"')
  })
})

describe('GeoBreakdownList — defensive narrowing', () => {
  it('tolerates a null rows prop', () => {
    const html = render(
      <GeoBreakdownList
        rows={null as unknown as AffiliateGeoBreakdownRow[]}
        daysBack={30}
      />,
    )
    expect(html).toContain('No clicks in the last 30 days.')
  })

  it('tolerates null sharePct (recomputes from clicksCount)', () => {
    const rows: AffiliateGeoBreakdownRow[] = [
      { country: 'US', clicksCount: 5, sharePct: null },
      { country: 'CA', clicksCount: 5, sharePct: null },
    ]
    const html = render(<GeoBreakdownList rows={rows} daysBack={30} />)
    // Each row is 50% of the total — recomputed
    expect(html).toContain('50.0%')
  })
})