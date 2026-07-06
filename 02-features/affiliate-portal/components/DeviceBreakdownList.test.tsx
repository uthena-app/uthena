// DeviceBreakdownList.test.tsx — P13.7 device_class breakdown list
// rendering.
//
// Pure component test via react-dom/server `renderToStaticMarkup`.
// Verifies:
//   - Header + "Device mix — last N days" copy
//   - One <li> per row with device label + glyph + share % + click
//     count
//   - Empty-state message
//   - "Unknown" bucket help caption when all rows are Unknown
//   - Device label + glyph mapping (mobile → "M", desktop → "D", …)

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DeviceBreakdownList } from './DeviceBreakdownList'
import type { AffiliateDeviceBreakdownRow } from '../queries/getAffiliateLinkAnalytics'
import type { ReactElement } from 'react'

function render(el: ReactElement) {
  return renderToStaticMarkup(el)
}

describe('DeviceBreakdownList — title + structure', () => {
  it('renders the title + "Device mix — last N days" copy', () => {
    const html = render(<DeviceBreakdownList rows={[]} daysBack={30} />)
    expect(html).toContain('Device mix — last 30 days')
    expect(html).toContain('Devices')
  })

  it('honors the custom daysBack value', () => {
    const html = render(<DeviceBreakdownList rows={[]} daysBack={14} />)
    expect(html).toContain('Device mix — last 14 days')
  })
})

describe('DeviceBreakdownList — empty state', () => {
  it('shows the empty-state message when rows are empty', () => {
    const html = render(<DeviceBreakdownList rows={[]} daysBack={30} />)
    expect(html).toContain('No clicks in the last 30 days.')
  })

  it('uses the daysBack value in the empty state', () => {
    const html = render(<DeviceBreakdownList rows={[]} daysBack={7} />)
    expect(html).toContain('No clicks in the last 7 days.')
  })
})

describe('DeviceBreakdownList — happy path', () => {
  it('renders one row per device_class', () => {
    const rows: AffiliateDeviceBreakdownRow[] = [
      { deviceClass: 'mobile',  clicksCount: 80, sharePct: 53.33 },
      { deviceClass: 'desktop', clicksCount: 60, sharePct: 40 },
      { deviceClass: 'tablet',  clicksCount: 10, sharePct: 6.67 },
    ]
    const html = render(<DeviceBreakdownList rows={rows} daysBack={30} />)
    expect((html.match(/data-device="/g) ?? []).length).toBe(3)
    expect(html).toContain('data-device="mobile"')
    expect(html).toContain('data-device="desktop"')
    expect(html).toContain('data-device="tablet"')
  })

  it('uses the device label + glyph for known classes', () => {
    const rows: AffiliateDeviceBreakdownRow[] = [
      { deviceClass: 'mobile',  clicksCount: 5, sharePct: 50 },
      { deviceClass: 'desktop', clicksCount: 3, sharePct: 30 },
      { deviceClass: 'tablet',  clicksCount: 1, sharePct: 10 },
      { deviceClass: 'bot',     clicksCount: 1, sharePct: 10 },
    ]
    const html = render(<DeviceBreakdownList rows={rows} daysBack={30} />)
    expect(html).toContain('Mobile')
    expect(html).toContain('Desktop')
    expect(html).toContain('Tablet')
    expect(html).toContain('Bot')
    // The glyphs are rendered inside the .deviceIcon span; check
    // the <span class="...deviceIcon...">M</span>-style elements.
    expect(html).toMatch(/deviceIcon[^"]*"[^>]*>M</)
    expect(html).toMatch(/deviceIcon[^"]*"[^>]*>D</)
    expect(html).toMatch(/deviceIcon[^"]*"[^>]*>T</)
    expect(html).toMatch(/deviceIcon[^"]*"[^>]*>B</)
  })

  it('renders share % + click count per row', () => {
    const rows: AffiliateDeviceBreakdownRow[] = [
      { deviceClass: 'mobile', clicksCount: 100, sharePct: 100 },
    ]
    const html = render(<DeviceBreakdownList rows={rows} daysBack={30} />)
    expect(html).toContain('100.0%')
    expect(html).toContain('100')
  })

  it('uses the singular "click" for 1-click rows', () => {
    const rows: AffiliateDeviceBreakdownRow[] = [
      { deviceClass: 'mobile', clicksCount: 1, sharePct: 100 },
    ]
    const html = render(<DeviceBreakdownList rows={rows} daysBack={30} />)
    expect(html).toMatch(/\b1\s+click\b/)
  })

  it('uses the plural "clicks" for 2+ rows', () => {
    const rows: AffiliateDeviceBreakdownRow[] = [
      { deviceClass: 'mobile', clicksCount: 2, sharePct: 100 },
    ]
    const html = render(<DeviceBreakdownList rows={rows} daysBack={30} />)
    expect(html).toMatch(/\b2\s+clicks\b/)
  })

  it('sorts rows by clicksCount desc (mobile before desktop)', () => {
    const rows: AffiliateDeviceBreakdownRow[] = [
      { deviceClass: 'desktop', clicksCount: 10, sharePct: 30 },
      { deviceClass: 'mobile',  clicksCount: 90, sharePct: 70 },
    ]
    const html = render(<DeviceBreakdownList rows={rows} daysBack={30} />)
    // The mobile row (90 clicks) appears before the desktop row
    // (10 clicks) in the markup.
    const mobileIdx = html.indexOf('data-device="mobile"')
    const desktopIdx = html.indexOf('data-device="desktop"')
    expect(mobileIdx).toBeGreaterThan(-1)
    expect(desktopIdx).toBeGreaterThan(-1)
    expect(mobileIdx).toBeLessThan(desktopIdx)
  })
})

describe('DeviceBreakdownList — Unknown bucket', () => {
  it('renders the help caption when every row is Unknown', () => {
    const rows: AffiliateDeviceBreakdownRow[] = [
      { deviceClass: 'Unknown', clicksCount: 100, sharePct: 100 },
    ]
    const html = render(<DeviceBreakdownList rows={rows} daysBack={30} />)
    expect(html).toContain('UA-classifier')
    expect(html).toMatch(/hasn(?:'|&#x27;)t been wired yet/)
  })

  it('does not render the help caption when there are known device classes', () => {
    const rows: AffiliateDeviceBreakdownRow[] = [
      { deviceClass: 'mobile',  clicksCount: 100, sharePct: 50 },
      { deviceClass: 'Unknown', clicksCount: 100, sharePct: 50 },
    ]
    const html = render(<DeviceBreakdownList rows={rows} daysBack={30} />)
    expect(html).not.toMatch(/hasn(?:'|&#x27;)t been wired yet/)
  })

  it('renders the Unknown bucket with dim styling', () => {
    const rows: AffiliateDeviceBreakdownRow[] = [
      { deviceClass: 'mobile',  clicksCount: 100, sharePct: 50 },
      { deviceClass: 'Unknown', clicksCount: 100, sharePct: 50 },
    ]
    const html = render(<DeviceBreakdownList rows={rows} daysBack={30} />)
    expect(html).toContain('data-device="Unknown"')
    expect(html).toContain('data-state="unknown"')
    expect(html).toContain('_deviceDim_')
  })

  it('uses the ? glyph for Unknown rows', () => {
    const rows: AffiliateDeviceBreakdownRow[] = [
      { deviceClass: 'Unknown', clicksCount: 5, sharePct: 100 },
    ]
    const html = render(<DeviceBreakdownList rows={rows} daysBack={30} />)
    expect(html).toMatch(/deviceIcon[^"]*"[^>]*>\?</)
  })
})

describe('DeviceBreakdownList — defensive narrowing', () => {
  it('tolerates a null rows prop', () => {
    const html = render(
      <DeviceBreakdownList
        rows={null as unknown as AffiliateDeviceBreakdownRow[]}
        daysBack={30}
      />,
    )
    expect(html).toContain('No clicks in the last 30 days.')
  })

  it('tolerates an unrecognized device class (falls back to "Unknown" label)', () => {
    const rows: AffiliateDeviceBreakdownRow[] = [
      { deviceClass: 'smart-fridge', clicksCount: 5, sharePct: 100 },
    ]
    const html = render(<DeviceBreakdownList rows={rows} daysBack={30} />)
    // Falls back to "Unknown" label + "?" glyph (the raw code is
    // preserved on the data-device attribute for traceability)
    expect(html).toContain('Unknown')
    expect(html).toContain('data-device="smart-fridge"')
  })

  it('tolerates null sharePct (recomputes from clicksCount)', () => {
    const rows: AffiliateDeviceBreakdownRow[] = [
      { deviceClass: 'mobile',  clicksCount: 5, sharePct: null },
      { deviceClass: 'desktop', clicksCount: 5, sharePct: null },
    ]
    const html = render(<DeviceBreakdownList rows={rows} daysBack={30} />)
    expect(html).toContain('50.0%')
  })
})