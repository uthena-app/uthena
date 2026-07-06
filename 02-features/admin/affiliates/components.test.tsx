// Components test for /admin/affiliates (P14.6).
//
// Covers AffiliateTable (rendering with rows, empty state, sort headers,
// status pill colors, conversion-rate formatting) and AffiliateFilters
// (URL params preserved on submit). Pure renderToStaticMarkup tests —
// no JS, no mocks.

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { AffiliateTable } from './components/AffiliateTable'
import { AffiliatePagination } from './components/AffiliatePagination'
import type { AffiliateRow, ParsedAffiliateFilters } from './types'

const EMPTY_FILTERS: ParsedAffiliateFilters = {
  status: null,
  joinedFrom: null,
  joinedTo: null,
  q: null,
}

function makeRow(overrides: Partial<AffiliateRow> = {}): AffiliateRow {
  return {
    affiliate_id: 1,
    user_id: '11111111-1111-1111-1111-111111111111',
    handle: 'klaas',
    display_name: 'Klaas Bo',
    email: 'klaas@example.com',
    status: 'approved',
    lifetime_earned_cents: 1234567,
    pending_balance_cents: 50000,
    available_balance_cents: 200000,
    clicks_30d: 1000,
    conversions_30d: 24,
    joined_at: '2026-06-01T00:00:00Z',
    approved_at: '2026-06-02T00:00:00Z',
    last_activity_at: '2026-06-29T00:00:00Z',
    total_count: 1,
    ...overrides,
  }
}

describe('AffiliateTable', () => {
  it('renders the empty state when no rows', () => {
    const html = renderToStaticMarkup(
      <AffiliateTable
        rows={[]}
        total={0}
        page={1}
        perPage={50}
        sort="earned_desc"
        filters={EMPTY_FILTERS}
      />,
    )
    expect(html).toContain('No affiliates match these filters.')
    expect(html).toContain('/admin/affiliates')
  })

  it('renders a row with name + handle + email + status + money + clicks + conversions', () => {
    const html = renderToStaticMarkup(
      <AffiliateTable
        rows={[makeRow()]}
        total={1}
        page={1}
        perPage={50}
        sort="earned_desc"
        filters={EMPTY_FILTERS}
      />,
    )
    expect(html).toContain('Klaas Bo')
    expect(html).toContain('@klaas')
    expect(html).toContain('klaas@example.com')
    expect(html).toContain('Approved') // status label
    expect(html).toContain('$12,345.67') // lifetime earned (1234567 cents)
    expect(html).toContain('$2,000.00') // available balance
    expect(html).toContain('$500.00') // pending balance
    expect(html).toContain('1,000') // clicks_30d
    expect(html).toContain('24') // conversions_30d
    expect(html).toContain('2.4%') // conversion rate (24/1000 = 2.4%)
    expect(html).toContain('/admin/affiliates/1') // row link
  })

  it('renders the summary line (showing X–Y of Z)', () => {
    const html = renderToStaticMarkup(
      <AffiliateTable
        rows={[makeRow()]}
        total={123}
        page={1}
        perPage={50}
        sort="earned_desc"
        filters={EMPTY_FILTERS}
      />,
    )
    expect(html).toContain('Showing')
    expect(html).toContain('1')
    expect(html).toContain('123')
  })

  it('uses data-status attribute for the status pill color', () => {
    const html = renderToStaticMarkup(
      <AffiliateTable
        rows={[makeRow({ status: 'pending' })]}
        total={1}
        page={1}
        perPage={50}
        sort="earned_desc"
        filters={EMPTY_FILTERS}
      />,
    )
    expect(html).toMatch(/data-status="pending"/)
    expect(html).toContain('Pending')
  })

  it('renders conversion rate as "—" when clicks=0', () => {
    const html = renderToStaticMarkup(
      <AffiliateTable
        rows={[makeRow({ clicks_30d: 0, conversions_30d: 0 })]}
        total={1}
        page={1}
        perPage={50}
        sort="earned_desc"
        filters={EMPTY_FILTERS}
      />,
    )
    expect(html).toContain('—')
  })

  it('renders a sub-1% conversion rate with 1 decimal place', () => {
    const html = renderToStaticMarkup(
      <AffiliateTable
        rows={[makeRow({ clicks_30d: 200, conversions_30d: 1 })]}
        total={1}
        page={1}
        perPage={50}
        sort="earned_desc"
        filters={EMPTY_FILTERS}
      />,
    )
    expect(html).toContain('0.5%')
  })

  it('renders a non-affiliate row by falling back to the id', () => {
    const html = renderToStaticMarkup(
      <AffiliateTable
        rows={[makeRow({ display_name: '', affiliate_id: 99 })]}
        total={1}
        page={1}
        perPage={50}
        sort="earned_desc"
        filters={EMPTY_FILTERS}
      />,
    )
    expect(html).toContain('Affiliate #99')
  })

  it('renders the sort header as a link with the next sort key', () => {
    const html = renderToStaticMarkup(
      <AffiliateTable
        rows={[makeRow()]}
        total={1}
        page={1}
        perPage={50}
        sort="earned_asc"
        filters={EMPTY_FILTERS}
      />,
    )
    // Sort header for Lifetime earned should toggle to earned_desc
    expect(html).toMatch(/href="\/admin\/affiliates\?sort=earned_desc"/)
  })

  it('preserves active filters in sort links', () => {
    const html = renderToStaticMarkup(
      <AffiliateTable
        rows={[makeRow()]}
        total={1}
        page={1}
        perPage={50}
        sort="earned_desc"
        filters={{
          status: 'approved',
          joinedFrom: '2026-01-01',
          joinedTo: '2026-06-30',
          q: 'klaas',
        }}
      />,
    )
    // Clicking the Name header should send ?sort=name_asc + the filter bag
    expect(html).toContain('status=approved')
    expect(html).toContain('joinedFrom=2026-01-01')
    expect(html).toContain('joinedTo=2026-06-30')
    expect(html).toContain('q=klaas')
  })

  it('emits the data-status attribute on the row (for CSS attribute selectors)', () => {
    const html = renderToStaticMarkup(
      <AffiliateTable
        rows={[makeRow({ status: 'suspended' })]}
        total={1}
        page={1}
        perPage={50}
        sort="earned_desc"
        filters={EMPTY_FILTERS}
      />,
    )
    expect(html).toMatch(/<tr[^>]*data-status="suspended"/)
  })
})

describe('AffiliatePagination', () => {
  it('renders nothing when total fits in one page', () => {
    const html = renderToStaticMarkup(
      <AffiliatePagination
        total={10}
        page={1}
        perPage={50}
        filters={EMPTY_FILTERS}
        sort="earned_desc"
      />,
    )
    expect(html).toBe('')
  })

  it('renders a pager with prev + pages + next when total > perPage', () => {
    const html = renderToStaticMarkup(
      <AffiliatePagination
        total={250}
        page={2}
        perPage={50}
        filters={EMPTY_FILTERS}
        sort="earned_desc"
      />,
    )
    expect(html).toContain('Previous')
    expect(html).toContain('Next')
    expect(html).toMatch(/aria-label="Previous page"/)
    expect(html).toMatch(/aria-label="Next page"/)
    expect(html).toContain('aria-current="page"')
  })

  it('disables Previous on the first page', () => {
    const html = renderToStaticMarkup(
      <AffiliatePagination
        total={250}
        page={1}
        perPage={50}
        filters={EMPTY_FILTERS}
        sort="earned_desc"
      />,
    )
    expect(html).toContain('aria-disabled="true"')
    expect(html).toContain('← Previous')
  })

  it('preserves the filter bag in page links', () => {
    const html = renderToStaticMarkup(
      <AffiliatePagination
        total={250}
        page={2}
        perPage={50}
        filters={{
          status: 'approved',
          joinedFrom: '2026-01-01',
          joinedTo: null,
          q: 'klaas',
        }}
        sort="earned_desc"
      />,
    )
    expect(html).toContain('status=approved')
    expect(html).toContain('joinedFrom=2026-01-01')
    expect(html).toContain('q=klaas')
  })
})