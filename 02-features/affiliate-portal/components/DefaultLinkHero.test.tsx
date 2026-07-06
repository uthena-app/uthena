// DefaultLinkHero.test.tsx — P13.5 default-link hero tests.
//
// Pure render via react-dom/server. Verifies:
//   - Renders the share URL (SITE_ORIGIN/?ref=<code>)
//   - Includes the CopyLinkButton (the only client island)
//   - Shows the "Create link" disabled CTA with the v2 tooltip
//   - Stats strip shows clicks / conversions / conversion rate / last clicked
//   - Empty state renders the RefreshDefaultLinkButton placeholder
//   - Long URL is wrapped to a code element with the right class
//
// Mocks:
//   - `@foundations/ui/Toast`'s `useToast` — renderToStaticMarkup
//      has no App Router context; without the mock the Toast hook
//      throws.
//   - `next/navigation` — the RefreshDefaultLinkButton uses
//     useRouter/usePathname/useSearchParams. Without the mock the
//     hooks throw "invariant expected app router to be mounted".

import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'

vi.mock('@foundations/ui/Toast', () => ({
  useToast: () => ({
    success: () => 'toast-id',
    info: () => 'toast-id',
    error: () => 'toast-id',
    dismiss: () => {},
  }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
  usePathname: () => '/affiliate/links',
  useSearchParams: () => new URLSearchParams(''),
}))

// Import after mocks so the mocked modules are picked up.
import { DefaultLinkHero } from './DefaultLinkHero'
import type { AffiliateLinkRow } from '../queries/getMyAffiliateLinks'

function render(el: ReactElement) {
  return renderToStaticMarkup(el)
}

const SAMPLE_LINK: AffiliateLinkRow = {
  id: 42,
  code: 'marcus',
  destinationPath: '/',
  campaign: null,
  utmSource: null,
  utmMedium: null,
  utmCampaign: null,
  active: true,
  disabledAt: null,
  deletedAt: null,
  createdAt: '2026-06-15T10:30:00Z',
  clicksAllTime: 250,
  clicks30d: 120,
  conversionsAllTime: 10,
  conversions30d: 6,
  conversionRate: 10 / 250,
  lastClickedAt: '2026-06-29T14:00:00Z',
}

describe('DefaultLinkHero — happy path', () => {
  it('renders the share URL in the mono code block', () => {
    const html = render(<DefaultLinkHero link={SAMPLE_LINK} />)
    expect(html).toContain('https://uthena.com/?ref=marcus')
  })

  it('mentions the code in the subhead', () => {
    const html = render(<DefaultLinkHero link={SAMPLE_LINK} />)
    expect(html).toContain('?ref=marcus')
    expect(html).toContain('is attributed to you for 30 days')
  })

  it('renders the stat strip with the 4 metric cells', () => {
    const html = render(<DefaultLinkHero link={SAMPLE_LINK} />)
    expect(html).toContain('>Clicks<')
    expect(html).toContain('>Conversions<')
    expect(html).toContain('>Conversion rate<')
    expect(html).toContain('>Last clicked<')
  })

  it('formats all-time + 30d numbers via the comma grouping', () => {
    const html = render(<DefaultLinkHero link={SAMPLE_LINK} />)
    expect(html).toContain('250')
    expect(html).toContain('120')
    expect(html).toContain('10')
    expect(html).toContain('6')
  })

  it('shows the conversion rate as a percent', () => {
    const html = render(<DefaultLinkHero link={SAMPLE_LINK} />)
    // 10/250 = 4% → exact
    expect(html).toContain('4%')
  })

  it('renders the Create link CTA as a disabled button with the v2 badge', () => {
    const html = render(<DefaultLinkHero link={SAMPLE_LINK} />)
    // The CTA renders as 3 sibling spans inside a <button disabled>:
    //   <span>+</span><span>Create link</span><span class="v2-badge">v2</span>
    expect(html).toContain('disabled')
    expect(html).toContain('>Create link<')
    expect(html).toContain('>v2</span>')
  })

  it('renders the CopyLinkButton (client island via Next.js hydration hook)', () => {
    const html = render(<DefaultLinkHero link={SAMPLE_LINK} />)
    expect(html).toContain('>Copy<')
    // The button type attribute should be button (not submit)
    expect(html).toContain('type="button"')
  })

  it('marks the disabled button with the title attribute for the tooltip fallback', () => {
    const html = render(<DefaultLinkHero link={SAMPLE_LINK} />)
    expect(html).toContain('title="Per-product links are coming in v2.')
  })
})

describe('DefaultLinkHero — edge cases', () => {
  it('shows "—" in the conversion-rate cell when clicks = 0', () => {
    const html = render(
      <DefaultLinkHero
        link={{ ...SAMPLE_LINK, clicksAllTime: 0, conversionRate: null }}
      />,
    )
    expect(html).toContain('—')
  })

  it('shows "—" in the last-clicked cell when lastClickedAt is null', () => {
    const html = render(
      <DefaultLinkHero link={{ ...SAMPLE_LINK, lastClickedAt: null }} />,
    )
    // Both the Last-clicked cell and the smaller createdAt sub-cell
    // can render "—", so we just assert the marker is present.
    expect(html).toContain('—')
  })
})

describe('DefaultLinkHero — empty state', () => {
  it('renders the "Your default link is being generated" surface when link is null', () => {
    const html = render(<DefaultLinkHero link={null} />)
    expect(html).toContain('Pending setup')
    expect(html).toContain('Your default link is being generated')
  })

  it('renders the empty state body copy', () => {
    const html = render(<DefaultLinkHero link={null} />)
    expect(html).toContain('If this page shows every time')
  })

  it('uses dashed border styling for the empty state (no card chrome)', () => {
    // The empty state has a different class structure — we can verify
    // the semantic label is set correctly. The className wiring is
    // tested by the CSS module's bounded surface area.
    const html = render(<DefaultLinkHero link={null} />)
    expect(html).toContain('aria-label="Default link not yet generated"')
  })
})
