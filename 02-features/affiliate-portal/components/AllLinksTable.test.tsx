// AllLinksTable.test.tsx — P13.6 all-links table tests.
//
// P13.6 added the status filter (active / disabled / all) — a
// client-side filter wired to `?status=`. The tests cover:
//   - Pure helpers (parseStatusFilter, applyStatusFilter)
//   - Structural surface (the 10-col table, action column,
//     row rendering, empty list — inherited from P13.5)
//   - Filter widget rendering (3 chips, active chip pressed,
//     url-keyed default)
//   - Filter summary strip ("Showing X of Y")
//   - Filtered empty state (e.g. "No disabled links yet")
//
// Mocks:
//   - `@foundations/ui/Toast`'s `useToast` — the embedded
//     CopyLinkButton calls it; without the ToastProvider it throws.
//   - `next/navigation` — the table is now `'use client'`; the
//     hooks must be mocked per-test via a setSearchParams helper
//     so we can exercise each `?status=` code path.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'

// Mock the Toast hook — the CopyLinkButton used inside the table
// calls `useToast()` outside a ToastProvider context.
vi.mock('@foundations/ui/Toast', () => ({
  useToast: () => ({
    success: () => 'toast-id',
    info: () => 'toast-id',
    error: () => 'toast-id',
    dismiss: () => {},
  }),
}))

// Mutable holders for the per-test next/navigation mocks. Each test
// can override `currentSearchParams` (or the router hooks) before
// rendering to exercise a specific URL state.
let currentSearchParams = new URLSearchParams('')
let currentPathname = '/affiliate/links'
const replaceMock = vi.fn()
const pushMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, push: pushMock, refresh: () => {} }),
  usePathname: () => currentPathname,
  useSearchParams: () => currentSearchParams,
}))

beforeEach(() => {
  currentSearchParams = new URLSearchParams('')
  currentPathname = '/affiliate/links'
  replaceMock.mockReset()
  pushMock.mockReset()
})

import {
  AllLinksTable,
  parseStatusFilter,
  applyStatusFilter,
} from './AllLinksTable'
import type { AffiliateLinkRow } from '../queries/getMyAffiliateLinks'

function render(el: ReactElement) {
  return renderToStaticMarkup(el)
}

function linkWith(overrides: Partial<AffiliateLinkRow>): AffiliateLinkRow {
  return {
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
    ...overrides,
  }
}

describe('parseStatusFilter — pure helper', () => {
  it('defaults to "active" when the param is missing or empty', () => {
    expect(parseStatusFilter(null)).toBe('active')
    expect(parseStatusFilter('')).toBe('active')
    expect(parseStatusFilter(undefined)).toBe('active')
  })
  it('parses the canonical 3 values', () => {
    expect(parseStatusFilter('active')).toBe('active')
    expect(parseStatusFilter('disabled')).toBe('disabled')
    expect(parseStatusFilter('all')).toBe('all')
  })
  it('falls back to "active" on garbage values (defense in depth)', () => {
    expect(parseStatusFilter('everything')).toBe('active')
    expect(parseStatusFilter('<script>')).toBe('active')
    expect(parseStatusFilter('ACTIVE')).toBe('active') // case-sensitive
    expect(parseStatusFilter('disabled; DROP TABLE')).toBe('active')
  })
})

describe('applyStatusFilter — pure helper', () => {
  const links: AffiliateLinkRow[] = [
    linkWith({ id: 1, code: 'a', disabledAt: null }),
    linkWith({ id: 2, code: 'b', disabledAt: '2026-06-20T10:00:00Z' }),
    linkWith({ id: 3, code: 'c', disabledAt: '2026-06-21T10:00:00Z' }),
  ]

  it('returns the full list for "all"', () => {
    expect(applyStatusFilter(links, 'all').map((l) => l.code)).toEqual(['a', 'b', 'c'])
  })
  it('returns only enabled rows for "active"', () => {
    expect(applyStatusFilter(links, 'active').map((l) => l.code)).toEqual(['a'])
  })
  it('returns only disabled rows for "disabled"', () => {
    expect(applyStatusFilter(links, 'disabled').map((l) => l.code)).toEqual(['b', 'c'])
  })
  it('returns a fresh array — does not mutate the input', () => {
    const before = links.map((l) => l.code)
    const result = applyStatusFilter(links, 'active')
    expect(links.map((l) => l.code)).toEqual(before)
    expect(result).not.toBe(links)
  })
  it('handles an empty list without throwing', () => {
    expect(applyStatusFilter([], 'active')).toEqual([])
    expect(applyStatusFilter([], 'disabled')).toEqual([])
    expect(applyStatusFilter([], 'all')).toEqual([])
  })
})

describe('AllLinksTable — header + structure', () => {
  it('renders the table with all 10 columns', () => {
    const html = render(<AllLinksTable links={[linkWith({})]} />)
    expect(html).toContain('>Code<')
    expect(html).toContain('>Target<')
    expect(html).toContain('UTM tags')
    expect(html).toContain('Clicks')
    expect(html).toContain('Conversions')
    expect(html).toContain('Conv. rate')
    expect(html).toContain('Status')
    expect(html).toContain('Created')
    expect(html).toContain('Last clicked')
    expect(html).toContain('Actions')
  })

  it('renders the section aria-label', () => {
    const html = render(<AllLinksTable links={[linkWith({})]} />)
    expect(html).toContain('aria-label="All your affiliate links"')
  })

  it('renders the v1 explanation in the header subline', () => {
    const html = render(<AllLinksTable links={[linkWith({})]} />)
    expect(html).toContain('In v1 you have one global link')
  })
})

describe('AllLinksTable — row rendering', () => {
  it('renders a single row per link', () => {
    const html = render(
      <AllLinksTable
        links={[
          linkWith({ id: 1, code: 'alpha' }),
          linkWith({ id: 2, code: 'bravo' }),
        ]}
      />,
    )
    expect(html).toContain('>alpha<')
    expect(html).toContain('>bravo<')
  })

  it('renders the URL share code prominently', () => {
    const html = render(<AllLinksTable links={[linkWith({ code: 'special' })]} />)
    expect(html).toContain('special')
  })

  it('renders the "Active" status pill when the link is enabled', () => {
    const html = render(<AllLinksTable links={[linkWith({ disabledAt: null })]} />)
    expect(html).toContain('data-status="active"')
    expect(html).toContain('Active')
  })

  it('renders the "Disabled" status pill when disabledAt is set', () => {
    // P13.6 status filter defaults to 'active' (which excludes
    // disabled rows). We flip the URL to ?status=all so the
    // disabled row remains visible in this test — the assertion
    // is about the row's status pill, not about default-filter
    // behavior (that's covered separately).
    currentSearchParams = new URLSearchParams('status=all')
    const html = render(
      <AllLinksTable
        links={[linkWith({ disabledAt: '2026-06-20T10:00:00Z' })]}
      />,
    )
    expect(html).toContain('data-status="disabled"')
    expect(html).toContain('>Disabled<')
  })

  it('renders UTM tags when at least one is set', () => {
    const html = render(
      <AllLinksTable
        links={[
          linkWith({
            utmSource: 'twitter',
            utmMedium: 'social',
            utmCampaign: 'launch',
          }),
        ]}
      />,
    )
    expect(html).toContain('twitter')
    expect(html).toContain('social')
    expect(html).toContain('launch')
  })

  it('renders the "—" placeholder when no UTM tags are set', () => {
    const html = render(<AllLinksTable links={[linkWith({})]} />)
    // The empty-utm case shows a dim "—" inside a styled <span>.
    // Multiple em-dashes appear in the same row (conversion rate +
    // last clicked when clicks=0/null), so we just assert presence.
    expect(html).toContain('—')
  })

  it('renders the action column with all four buttons', () => {
    const html = render(<AllLinksTable links={[linkWith({})]} />)
    expect(html).toContain('Copy') // Copy action label
    expect(html).toContain('>QR<') // QR action label
    expect(html).toContain('>Disable<')
    expect(html).toContain('>Delete<')
  })

  it('renders QR + Disable + Delete buttons as disabled (v2 deferred)', () => {
    const html = render(<AllLinksTable links={[linkWith({})]} />)
    // Exactly 3 action-disabled buttons: QR + Disable + Delete.
    // The active status chip uses `aria-pressed` + `data-active`,
    // NOT `disabled`, per the codebase convention (matches
    // VaultFilterBar / DownloadHistoryFilters).
    const disabledCount = (html.match(/\sdisabled(="")?(?=>|\s)/g) ?? []).length
    expect(disabledCount).toBe(3)
  })

  it('renders the conversion rate as a percent when there are clicks', () => {
    const html = render(<AllLinksTable links={[linkWith({})]} />)
    expect(html).toContain('4%')
  })
})

describe('AllLinksTable — empty list', () => {
  it('renders the "No links yet" row when the array is empty', () => {
    const html = render(<AllLinksTable links={[]} />)
    expect(html).toContain('No links yet')
  })

  it('does NOT show the filter summary on an empty list with the default filter', () => {
    const html = render(<AllLinksTable links={[]} />)
    expect(html).not.toContain('Showing 0 of 0')
  })
})

describe('AllLinksTable — status filter widget (P13.6)', () => {
  // React serializes JSX attributes in JSX-source order, which means
  // `data-active` and `aria-label` may appear in either order depending
  // on the JSX. We test by capturing the WHOLE active-chip opening tag
  // — order-agnostic and asset-by-asset.
  function activeChipHtml(html: string): string | null {
    const m = html.match(/<button[^>]*data-active="true"[^>]*>/)
    return m ? m[0] : null
  }

  it('renders all three filter chips in the fieldset', () => {
    const html = render(<AllLinksTable links={[linkWith({})]} />)
    expect(html).toContain('aria-label="Filter links by status"')
    expect(html).toContain('aria-label="Filter: Active"')
    expect(html).toContain('aria-label="Filter: Disabled"')
    expect(html).toContain('aria-label="Filter: All"')
  })

  it('defaults to "active" when the URL has no ?status=', () => {
    currentSearchParams = new URLSearchParams('')
    const html = render(<AllLinksTable links={[linkWith({})]} />)
    const active = activeChipHtml(html)
    expect(active).not.toBeNull()
    expect(active).toContain('aria-label="Filter: Active"')
    expect(active).toContain('aria-pressed="true"')
  })

  it('marks the "disabled" chip active when ?status=disabled', () => {
    currentSearchParams = new URLSearchParams('status=disabled')
    const html = render(<AllLinksTable links={[]} />)
    const active = activeChipHtml(html)
    expect(active).not.toBeNull()
    expect(active).toContain('aria-label="Filter: Disabled"')
    expect(active).toContain('aria-pressed="true"')
  })

  it('marks the "all" chip active when ?status=all', () => {
    currentSearchParams = new URLSearchParams('status=all')
    const html = render(<AllLinksTable links={[]} />)
    const active = activeChipHtml(html)
    expect(active).not.toBeNull()
    expect(active).toContain('aria-label="Filter: All"')
    expect(active).toContain('aria-pressed="true"')
  })

  it('falls back to "active" when ?status= has an unknown value', () => {
    currentSearchParams = new URLSearchParams('status=garbage')
    const html = render(<AllLinksTable links={[]} />)
    const active = activeChipHtml(html)
    expect(active).not.toBeNull()
    expect(active).toContain('aria-label="Filter: Active"')
  })

  it('does not render `disabled` on the pressed chip — re-clicking is a no-op via setStatus guard', () => {
    const html = render(<AllLinksTable links={[linkWith({})]} />)
    // The codebase convention (matches VaultFilterBar +
    // DownloadHistoryFilters) is to keep the chip focusable +
    // clickable even when active, with the click handler
    // short-circuiting via the setStatus guard. The active chip
    // uses `aria-pressed` + `data-active`, NOT `disabled`.
    const active = activeChipHtml(html) ?? ''
    expect(active).not.toContain('disabled=')
  })

  it('does NOT show the filter summary when status=active (default)', () => {
    currentSearchParams = new URLSearchParams('')
    const html = render(<AllLinksTable links={[linkWith({})]} />)
    expect(html).not.toContain('Showing 1 of 1')
  })

  it('shows the summary strip "Showing X of Y" when filter is active', () => {
    currentSearchParams = new URLSearchParams('status=disabled')
    const html = render(
      <AllLinksTable
        links={[
          linkWith({ id: 1, code: 'a', disabledAt: null }),
          linkWith({ id: 2, code: 'b', disabledAt: '2026-06-20T10:00:00Z' }),
          linkWith({ id: 3, code: 'c', disabledAt: '2026-06-21T10:00:00Z' }),
        ]}
      />,
    )
    expect(html).toContain('Showing 2 of 3 link')
    expect(html).toContain('Show active')
  })

  it('shows the filtered empty state when no rows match the filter', () => {
    currentSearchParams = new URLSearchParams('status=disabled')
    const html = render(
      <AllLinksTable
        links={[linkWith({ id: 1, code: 'a', disabledAt: null })]}
      />,
    )
    const matchesDisabled =
      html.includes('No links match the "disabled" filter.') ||
      html.includes('No links match the &quot;disabled&quot; filter.')
    expect(matchesDisabled).toBe(true)
    expect(html).not.toContain('No links yet')
  })

  it('keeps the "No links yet" message when both the list AND the filter are empty', () => {
    currentSearchParams = new URLSearchParams('status=all')
    const html = render(<AllLinksTable links={[]} />)
    expect(html).toContain('No links yet')
  })
})
