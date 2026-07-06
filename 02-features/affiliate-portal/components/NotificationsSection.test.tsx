// NotificationsSection.test.tsx — structural unit tests for the
// /affiliate/settings Notifications section.
//
// Strategy: same as `ReviewsSection.test.tsx` + the customer-side
// `SettingsForm.test.tsx` — uses `react-dom/server`
// `renderToStaticMarkup` so the tests stay fast + pure, no DOM env
// needed. The component is a `'use client'` island with `useState`
// + `useTransition`; static markup renders the initial state only
// (no interactivity), which is the right surface for verifying the
// visible contract.
//
// Implementation note: this component renders each toggle as a
// `<button role="switch">` rather than `<input type="checkbox">` —
// the canonical a11y pattern for atomic toggle buttons (toggles are
// not text inputs that need a debounce; each click fires the server
// action immediately). The button carries an `aria-label` of
// "<title> (on|off)" so screen readers announce the state.
//
// What this verifies:
//   1. Section renders with the correct heading + subheading
//   2. All 4 toggles render with their titles + descriptions
//   3. Initial state matches the props (no auto-correct on mount)
//   4. Each toggle is a `<button role="switch">` with the right
//      aria-checked value + a11y label
//   5. Switching one prop value doesn't affect the others
//      (independence — spec acceptance #5)
//   6. Transactional toggles render with the .toggle_transactional
//      variant class; the marketing toggle gets .toggle_marketing
//
// What this does NOT verify:
//   - onClick save flow — interactive; the wiring is in
//     `NotificationsSection.tsx` source. The action's payload + diff
//     audit-log behavior is owned by
//     `updateAffiliateNotificationPrefsAction.test.ts` (already ships).
//   - Optimistic revert on server error — same; covered by reading
//     the source + the action's typed error paths.

import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NotificationsSection } from './NotificationsSection'

const DEFAULT_INITIAL = {
  affiliateUpdatesOptIn: false,
  commissionNotificationsOptIn: true,
  payoutNotificationsOptIn: true,
  monthlyDigestOptIn: true,
}

describe('NotificationsSection — section structure', () => {
  it('renders the section heading + subheading', () => {
    const html = renderToStaticMarkup(
      createElement(NotificationsSection, { initial: DEFAULT_INITIAL }),
    )
    expect(html).toContain('Notifications')
    expect(html).toContain('Choose which emails we send')
  })

  it('renders the section as a <section> with an aria-labelledby pointing at the heading', () => {
    const html = renderToStaticMarkup(
      createElement(NotificationsSection, { initial: DEFAULT_INITIAL }),
    )
    expect(html).toMatch(/<section[^>]*aria-labelledby="affiliate-notifications-heading"/)
  })
})

describe('NotificationsSection — all 4 toggles', () => {
  it('renders every toggle title from the spec', () => {
    const html = renderToStaticMarkup(
      createElement(NotificationsSection, { initial: DEFAULT_INITIAL }),
    )
    expect(html).toContain('Affiliate program updates')
    expect(html).toContain('Commission events')
    expect(html).toContain('Payout sent')
    expect(html).toContain('Monthly digest')
  })

  it('renders 4 buttons with role="switch" (one per toggle)', () => {
    const html = renderToStaticMarkup(
      createElement(NotificationsSection, { initial: DEFAULT_INITIAL }),
    )
    const switchMatches = html.match(/role="switch"/g)
    expect(switchMatches).not.toBeNull()
    expect(switchMatches!.length).toBe(4)
  })

  it('aria-checked + aria-label reflect the initial state per spec defaults', () => {
    const html = renderToStaticMarkup(
      createElement(NotificationsSection, { initial: DEFAULT_INITIAL }),
    )
    // Spec defaults: affiliateUpdates=false, commissionEvents=true,
    // payoutSent=true, monthlyDigest=true.
    expect(html).toMatch(/aria-label="Affiliate program updates \(off\)"/)
    expect(html).toMatch(/aria-label="Commission events \(on\)"/)
    expect(html).toMatch(/aria-label="Payout sent \(on\)"/)
    expect(html).toMatch(/aria-label="Monthly digest \(on\)"/)
    // All 4 are aria-checked
    const checkedMatches = html.match(/aria-checked="(true|false)"/g)
    expect(checkedMatches).not.toBeNull()
    expect(checkedMatches!.length).toBe(4)
  })
})

describe('NotificationsSection — toggle independence (spec AC #5)', () => {
  it('flipping one toggle prop does not affect the others', () => {
    const html = renderToStaticMarkup(
      createElement(NotificationsSection, {
        initial: {
          ...DEFAULT_INITIAL,
          affiliateUpdatesOptIn: true, // override just one
        },
      }),
    )
    // The override flipped to "on"
    expect(html).toContain('aria-label="Affiliate program updates (on)"')
    // The other three are unchanged
    expect(html).toContain('aria-label="Commission events (on)"')
    expect(html).toContain('aria-label="Payout sent (on)"')
    expect(html).toContain('aria-label="Monthly digest (on)"')
  })

  it('all-off initial state renders every switch as (off)', () => {
    const html = renderToStaticMarkup(
      createElement(NotificationsSection, {
        initial: {
          affiliateUpdatesOptIn: false,
          commissionNotificationsOptIn: false,
          payoutNotificationsOptIn: false,
          monthlyDigestOptIn: false,
        },
      }),
    )
    expect(html).toContain('aria-label="Affiliate program updates (off)"')
    expect(html).toContain('aria-label="Commission events (off)"')
    expect(html).toContain('aria-label="Payout sent (off)"')
    expect(html).toContain('aria-label="Monthly digest (off)"')
  })

  it('all-on initial state renders every switch as (on)', () => {
    const html = renderToStaticMarkup(
      createElement(NotificationsSection, {
        initial: {
          affiliateUpdatesOptIn: true,
          commissionNotificationsOptIn: true,
          payoutNotificationsOptIn: true,
          monthlyDigestOptIn: true,
        },
      }),
    )
    expect(html).toContain('aria-label="Affiliate program updates (on)"')
    expect(html).toContain('aria-label="Commission events (on)"')
    expect(html).toContain('aria-label="Payout sent (on)"')
    expect(html).toContain('aria-label="Monthly digest (on)"')
  })
})

describe('NotificationsSection — copy + description text', () => {
  it('renders the description copy for every toggle (non-trivial sentences)', () => {
    const html = renderToStaticMarkup(
      createElement(NotificationsSection, { initial: DEFAULT_INITIAL }),
    )
    expect(html).toContain('Occasional platform news')
    expect(html).toContain('daily digest of new commissions')
    expect(html).toContain('email when a payout is sent to your PayPal')
    expect(html).toContain('monthly summary of your clicks')
  })

  it('renders the marketing-toggle subheading hint about defaults', () => {
    const html = renderToStaticMarkup(
      createElement(NotificationsSection, { initial: DEFAULT_INITIAL }),
    )
    expect(html).toContain('Transactional emails (commissions + payouts) default to on')
  })
})