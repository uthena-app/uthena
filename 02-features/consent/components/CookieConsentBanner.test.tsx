// CookieConsentBanner.test.tsx — unit tests for the P11.2 client
// island. These tests use `react-dom/server`'s `renderToStaticMarkup`
// so we can assert the rendered HTML without a DOM. We focus on
// structural correctness + the show/hide + the three CTA shapes —
// interactivity is covered by the action tests + manual smoke.
//
// We render against a faked action module so the form's submit
// handler doesn't actually hit the server; that's tested separately
// in recordBannerDecision.test.ts.

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

// Capture action calls so we can assert.
const actionCalls: unknown[] = []

vi.mock('../actions/recordBannerDecision', () => ({
  recordBannerDecisionAction: vi.fn(async (payload: unknown) => {
    actionCalls.push(payload)
    return { ok: true, decision: { essential: true, analytics: true, marketing: true } }
  }),
}))

// next/navigation hooks — Next.js ship-stub. The router.refresh +
// useRouter import tree gets the test-only stub.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

const { CookieConsentBanner } = await import('./CookieConsentBanner')

describe('CookieConsentBanner — visibility', () => {
  it('renders null when showBanner is false (no DOM)', () => {
    const html = renderToStaticMarkup(
      <CookieConsentBanner
        bannerState={{
          showBanner: false,
          gpcActive: false,
          euRegion: false,
          hasPriorDecision: false,
          consent: { essential: true, analytics: false, marketing: false },
          reason: 'hide_non_eu_geo',
        }}
      />,
    )
    expect(html).toBe('')
  })

  it('renders the dialog when showBanner is true', () => {
    const html = renderToStaticMarkup(
      <CookieConsentBanner
        bannerState={{
          showBanner: true,
          gpcActive: false,
          euRegion: true,
          hasPriorDecision: false,
          consent: { essential: true, analytics: false, marketing: false },
          reason: 'show_eu_geo',
        }}
      />,
    )
    expect(html).toContain('Choose your cookies')
    expect(html).toContain('Accept all')
    expect(html).toContain('Decline non-essential')
    expect(html).toContain('Customize')
  })
})

describe('CookieConsentBanner — geo copy switching', () => {
  it('renders the EU-specific copy when geo is EU', () => {
    const html = renderToStaticMarkup(
      <CookieConsentBanner
        bannerState={{
          showBanner: true,
          gpcActive: false,
          euRegion: true,
          hasPriorDecision: false,
          consent: { essential: true, analytics: false, marketing: false },
          reason: 'show_eu_geo',
        }}
      />,
    )
    expect(html).toContain('EU')
    expect(html).toMatch(/You\u2019re in the EU|You&#x2019;re in the EU|You're in the EU/)
  })

  it('renders the generic copy when geo is unknown (fall-back to show-all)', () => {
    const html = renderToStaticMarkup(
      <CookieConsentBanner
        bannerState={{
          showBanner: true,
          gpcActive: false,
          euRegion: null,
          hasPriorDecision: false,
          consent: { essential: true, analytics: false, marketing: false },
          reason: 'show_unknown_geo',
        }}
      />,
    )
    expect(html).not.toMatch(/You\u2019re in the EU|You&#x2019;re in the EU|You're in the EU/)
    expect(html).toContain('We use cookies to keep you signed in')
  })
})

describe('CookieConsentBanner — manages preferences link', () => {
  it('always renders a deep-link to /cookie-preferences', () => {
    const html = renderToStaticMarkup(
      <CookieConsentBanner
        bannerState={{
          showBanner: true,
          gpcActive: false,
          euRegion: true,
          hasPriorDecision: false,
          consent: { essential: true, analytics: false, marketing: false },
          reason: 'show_eu_geo',
        }}
      />,
    )
    expect(html).toContain('href="/cookie-preferences"')
    expect(html).toContain('Manage cookie preferences')
  })
})
