// Component tests for the admin partners list. Pure RSC components,
// rendered via renderToStaticMarkup to verify the static HTML structure.
//
// Coverage:
//   - PartnerStatsCards (5 cards in the expected order)
//   - PartnerFilters (form fields + default values)

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PartnerStatsCards } from './components/PartnerStatsCards'
import { PartnerFilters } from './components/PartnerFilters'
import { EMPTY_PARTNER_STATS } from './types'

describe('PartnerStatsCards', () => {
  it('renders all 5 cards in canonical order with zero counts', () => {
    const html = renderToStaticMarkup(<PartnerStatsCards stats={EMPTY_PARTNER_STATS} />)
    expect(html).toContain('Total partners')
    expect(html).toContain('Pending review')
    expect(html).toContain('Suspended')
    expect(html).toContain('Approved this month')
    expect(html).toContain('Lifetime partner revenue')
    expect(html).toContain('Partner stats')
  })

  it('renders the lifetime revenue as currency', () => {
    const html = renderToStaticMarkup(
      <PartnerStatsCards
        stats={{
          ...EMPTY_PARTNER_STATS,
          lifetimeRevenueCents: 123_456_78, // 12,345,678 cents = $123,456.78
        }}
      />,
    )
    expect(html).toContain('$123,456.78')
  })

  it('renders pending as warn-tone color via data-stat', () => {
    const html = renderToStaticMarkup(<PartnerStatsCards stats={EMPTY_PARTNER_STATS} />)
    expect(html).toContain('data-stat="pending"')
    expect(html).toContain('data-stat="suspended"')
    expect(html).toContain('data-stat="approvedThisMonth"')
  })

  it('locale-formats integer counts', () => {
    const html = renderToStaticMarkup(
      <PartnerStatsCards
        stats={{
          ...EMPTY_PARTNER_STATS,
          total: 12345,
          pending: 678,
        }}
      />,
    )
    expect(html).toContain('12,345')
    expect(html).toContain('678')
  })
})

describe('PartnerFilters', () => {
  it('renders all 6 fields + Apply + Reset', () => {
    const html = renderToStaticMarkup(
      <PartnerFilters
        filters={{
          status: null,
          kycStatus: null,
          taxFormStatus: null,
          appliedFrom: null,
          appliedTo: null,
          q: null,
        }}
        sort="revenue_desc"
      />,
    )
    expect(html).toContain('name="q"')
    expect(html).toContain('name="status"')
    expect(html).toContain('name="kycStatus"')
    expect(html).toContain('name="taxFormStatus"')
    expect(html).toContain('name="appliedFrom"')
    expect(html).toContain('name="appliedTo"')
    expect(html).toContain('type="submit"')
    expect(html).toContain('Reset')
    expect(html).toContain('Apply')
  })

  it('preserves the active sort via a hidden input', () => {
    const html = renderToStaticMarkup(
      <PartnerFilters
        filters={{
          status: null,
          kycStatus: null,
          taxFormStatus: null,
          appliedFrom: null,
          appliedTo: null,
          q: null,
        }}
        sort="revenue_desc"
      />,
    )
    expect(html).toContain('type="hidden"')
    expect(html).toContain('value="revenue_desc"')
  })

  it('pre-fills active filter values', () => {
    const html = renderToStaticMarkup(
      <PartnerFilters
        filters={{
          status: 'pending',
          kycStatus: 'approved',
          taxFormStatus: 'submitted',
          appliedFrom: '2026-01-01',
          appliedTo: '2026-12-31',
          q: 'partner',
        }}
        sort="revenue_desc"
      />,
    )
    expect(html).toContain('value="partner"')
    // status="pending" → the "Pending" <option> gets `selected=""`
    expect(html).toContain('value="pending" selected=""')
    // kycStatus="approved" → the "Approved" <option> gets `selected=""`
    expect(html).toContain('value="approved" selected=""')
    expect(html).toContain('value="2026-01-01"')
    expect(html).toContain('value="2026-12-31"')
  })

  it('renders all 4 status options', () => {
    const html = renderToStaticMarkup(
      <PartnerFilters
        filters={{
          status: null,
          kycStatus: null,
          taxFormStatus: null,
          appliedFrom: null,
          appliedTo: null,
          q: null,
        }}
        sort="revenue_desc"
      />,
    )
    expect(html).toContain('Pending')
    expect(html).toContain('Approved')
    expect(html).toContain('Suspended')
  })
})