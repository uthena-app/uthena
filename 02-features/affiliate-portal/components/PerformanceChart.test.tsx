// PerformanceChart.test.tsx — P13.4 chart rendering.
//
// Pure component test via react-dom/server `renderToStaticMarkup`.
// Verifies:
//   - Headline tile aggregates (clicks / conversions / revenue)
//   - Title + "Last N days" copy
//   - Empty-state message when the series has no data
//   - SVG renders the bars + markers + axis labels when data exists
//   - Legend renders 3 items with the right kind attributes
//   - Conversion rate shows for clicks > 0 (percentage of clicks)
//   - "—" placeholder when clicks = 0
//
// Uses the vitest node env (no jsdom) — renderToStaticMarkup is
// sufficient for the structural assertions here. Interactive /
// hover behavior (the SVG `<title>` tooltips, CSS hover transitions)
// is verified manually via `pnpm dev` smoke per the cron protocol.

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PerformanceChart } from './PerformanceChart'
import type { AffiliateDailyPerformancePoint } from '../queries/getAffiliateDailyPerformance'
import type { ReactElement } from 'react'

function render(el: ReactElement) {
  return renderToStaticMarkup(el)
}

const sample: AffiliateDailyPerformancePoint[] = [
  { day: '2026-06-01', clicksCount: 100, conversionsCount: 2, revenueCents: 3000 },
  { day: '2026-06-02', clicksCount: 150, conversionsCount: 5, revenueCents: 7500 },
  { day: '2026-06-03', clicksCount: 80,  conversionsCount: 1, revenueCents: 1500 },
]

describe('PerformanceChart — headline tiles', () => {
  it('aggregates totals correctly across the series', () => {
    const html = render(<PerformanceChart series={sample} daysBack={3} />)
    // clicks: 100+150+80 = 330
    expect(html).toContain('330')
    // conversions: 2+5+1 = 8
    expect(html).toContain('>8<')
    // Revenue heading uses formatMoney — total = $120.00
    expect(html).toContain('$120.00')
  })

  it('computes the conversion rate as percentage of clicks', () => {
    const html = render(<PerformanceChart series={sample} daysBack={3} />)
    // 8 / 330 * 100 = 2.4242... → toFixed(1) = 2.4
    expect(html).toContain('2.4%')
    expect(html).toContain('of clicks')
  })

  it('shows a dash placeholder when clicks = 0', () => {
    const noClicks: AffiliateDailyPerformancePoint[] = [
      { day: '2026-06-01', clicksCount: 0, conversionsCount: 0, revenueCents: 0 },
      { day: '2026-06-02', clicksCount: 0, conversionsCount: 0, revenueCents: 0 },
    ]
    const html = render(
      <PerformanceChart series={noClicks} daysBack={2} />,
    )
    expect(html).toContain('—')
  })
})

describe('PerformanceChart — title + structure', () => {
  it('renders the title + "Last N days" subtitle', () => {
    const html = render(<PerformanceChart series={sample} daysBack={30} />)
    expect(html).toContain('Last 30 days')
    expect(html).toContain('Performance')
  })

  it('uses the custom daysBack value in the heading', () => {
    const html = render(<PerformanceChart series={sample} daysBack={14} />)
    expect(html).toContain('Last 14 days')
  })

  it('renders 3 KPI tiles in the headline strip', () => {
    const html = render(<PerformanceChart series={sample} daysBack={30} />)
    expect(html).toContain('aria-label="Total clicks"')
    expect(html).toContain('aria-label="Total conversions"')
    expect(html).toContain('aria-label="Total revenue"')
  })
})

describe('PerformanceChart — empty state', () => {
  it('shows the empty-state message when the series is empty', () => {
    const html = render(<PerformanceChart series={[]} daysBack={30} />)
    expect(html).toContain('No clicks or conversions in the last 30 days.')
    // No SVG should render in empty state
    expect(html).not.toContain('<svg')
  })

  it('shows the empty-state message when the series is all zeros', () => {
    const zeros: AffiliateDailyPerformancePoint[] = [
      { day: '2026-06-01', clicksCount: 0, conversionsCount: 0, revenueCents: 0 },
      { day: '2026-06-02', clicksCount: 0, conversionsCount: 0, revenueCents: 0 },
    ]
    const html = render(<PerformanceChart series={zeros} daysBack={2} />)
    expect(html).toContain('No clicks or conversions in the last 2 days.')
  })
})

describe('PerformanceChart — chart SVG + markers', () => {
  it('renders the inline SVG with the correct viewBox + role', () => {
    const html = render(<PerformanceChart series={sample} daysBack={3} />)
    expect(html).toContain('<svg')
    expect(html).toContain('viewBox="0 0 720 200"')
    expect(html).toContain('role="img"')
  })

  it('renders revenue bars + click dots + conversion squares', () => {
    const html = render(<PerformanceChart series={sample} daysBack={3} />)
    // Rect for bars — there's one per series point + gridline + legend squares
    expect(html).toContain('rx="2"')
    // Circle for click markers
    expect(html).toContain('<circle')
    // Conversion square (small <rect width="4" height="4">)
    expect(html).toMatch(/width="4"[^>]*height="4"/)
  })

  it('renders the X axis labels (first / mid / last day)', () => {
    const html = render(<PerformanceChart series={sample} daysBack={3} />)
    // The 3 sample days: 2026-06-01, 02, 03 → in en-US short format
    // We don't assert exact strings since locale formatting varies
    // across CI environments, but the X axis 3 labels must render.
    // Count <text> elements that look like axis labels (small font).
    const textTags = html.match(/<text[^>]*class="[^"]*axisLabel/g)
    expect(textTags).not.toBeNull()
    expect(textTags!.length).toBeGreaterThanOrEqual(3)
  })
})

describe('PerformanceChart — legend', () => {
  it('renders 3 legend items with the right kind attributes', () => {
    const html = render(<PerformanceChart series={sample} daysBack={3} />)
    expect(html).toContain('aria-label="Chart legend"')
    expect(html).toContain('data-kind="revenue"')
    expect(html).toContain('data-kind="clicks"')
    expect(html).toContain('data-kind="conversions"')
    expect(html).toContain('>Revenue<')
    expect(html).toContain('>Clicks<')
    expect(html).toContain('>Conversions<')
  })

  it('does not render the legend in the empty state (no chart body)', () => {
    const html = render(<PerformanceChart series={[]} daysBack={30} />)
    expect(html).not.toContain('aria-label="Chart legend"')
  })
})

describe('PerformanceChart — defensive narrowing', () => {
  it('tolerates a null series prop', () => {
    // The component signature expects an array; tests are written
    // against the public API. A null series is treated as empty
    // — but TS would reject it. Defensive runtime check is in the
    // component body via `safeSeries = series ?? []`. Cast to any
    // to verify the runtime fallback path.
    const html = render(
      <PerformanceChart
        series={null as unknown as AffiliateDailyPerformancePoint[]}
        daysBack={30}
      />,
    )
    expect(html).toContain('No clicks or conversions in the last 30 days.')
  })

  it('clamps negative day strings (bad data) without throwing', () => {
    const bad: AffiliateDailyPerformancePoint[] = [
      { day: '', clicksCount: 5, conversionsCount: 1, revenueCents: 1500 },
    ]
    const html = render(<PerformanceChart series={bad} daysBack={1} />)
    expect(html).toContain('Performance')
    // No throw; the chart renders
  })
})
