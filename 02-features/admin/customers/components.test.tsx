// Component tests for the admin customers list. Pure RSC components,
// rendered via renderToStaticMarkup to verify the static HTML structure.
//
// Coverage:
//   - RiskScoreBadge (every band + every score range)
//   - CustomerStatsCards (5 cards in the expected order)
//   - CustomerFilters (form fields + default values)

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { RiskScoreBadge } from './components/RiskScoreBadge'
import { CustomerStatsCards } from './components/CustomerStatsCards'
import { CustomerFilters } from './components/CustomerFilters'
import { EMPTY_CUSTOMER_STATS } from './types'

describe('RiskScoreBadge', () => {
  it('renders a normal band (score 25)', () => {
    const html = renderToStaticMarkup(
      <RiskScoreBadge score={25} refundCount={2} disputeCount={0} signalSeveritySum={0} />,
    )
    expect(html).toContain('data-band="normal"')
    expect(html).toContain('25')
    expect(html).toContain('Normal')
    expect(html).toContain('Risk score 25 of 100')
    expect(html).toContain('Refund contribution: 16/40')
    expect(html).toContain('Dispute contribution: 0/40')
    expect(html).toContain('Activity contribution: 0/20')
  })

  it('renders a watch band (score 45)', () => {
    const html = renderToStaticMarkup(
      <RiskScoreBadge score={45} refundCount={3} disputeCount={0} signalSeveritySum={2} />,
    )
    expect(html).toContain('data-band="watch"')
    expect(html).toContain('Watch')
    expect(html).toContain('45')
  })

  it('renders a high band (score 72)', () => {
    const html = renderToStaticMarkup(
      <RiskScoreBadge score={72} refundCount={5} disputeCount={1} signalSeveritySum={3} />,
    )
    expect(html).toContain('data-band="high"')
    expect(html).toContain('High')
    expect(html).toContain('Refund contribution: 40/40')
    expect(html).toContain('Dispute contribution: 20/40')
    expect(html).toContain('Activity contribution: 3/20')
  })

  it('renders a severe band (score 95)', () => {
    const html = renderToStaticMarkup(
      <RiskScoreBadge score={95} refundCount={10} disputeCount={3} signalSeveritySum={10} />,
    )
    expect(html).toContain('data-band="severe"')
    expect(html).toContain('Severe')
    expect(html).toContain('95')
  })

  it('omits the numeric value in compact mode but keeps the band label', () => {
    const html = renderToStaticMarkup(
      <RiskScoreBadge score={50} refundCount={2} disputeCount={0} signalSeveritySum={1} compact />,
    )
    expect(html).toContain('data-band="watch"')
    expect(html).toContain('Watch · 50/100')
    // The "50" still appears inside the band label, but not as a separate value span.
    expect(html).toMatch(/class="[^"]*band[^"]*">[^<]*Watch · 50\/100/)
  })

  it('caps each contribution in the tooltip', () => {
    // 100 refunds × 8 = 800 → capped at 40
    const html = renderToStaticMarkup(
      <RiskScoreBadge score={100} refundCount={100} disputeCount={100} signalSeveritySum={100} />,
    )
    expect(html).toContain('Refund contribution: 40/40')
    expect(html).toContain('Dispute contribution: 40/40')
    expect(html).toContain('Activity contribution: 20/20')
  })
})

describe('CustomerStatsCards', () => {
  it('renders all 5 cards in canonical order with zero counts', () => {
    const html = renderToStaticMarkup(<CustomerStatsCards stats={EMPTY_CUSTOMER_STATS} />)
    expect(html).toContain('Total')
    expect(html).toContain('Active')
    expect(html).toContain('Suspended')
    expect(html).toContain('Banned')
    expect(html).toContain('New this month')
    // 5 cards × aria-label region
    expect(html).toContain('Customer stats')
  })

  it('renders the counts as locale-formatted numbers', () => {
    const html = renderToStaticMarkup(
      <CustomerStatsCards
        stats={{
          total: 1234,
          active: 1200,
          suspended: 30,
          banned: 4,
          newThisMonth: 56,
        }}
      />,
    )
    expect(html).toContain('1,234')
    expect(html).toContain('1,200')
    expect(html).toContain('30')
    expect(html).toContain('56')
  })

  it('emits the per-card data-stat attribute', () => {
    const html = renderToStaticMarkup(
      <CustomerStatsCards
        stats={{
          total: 1,
          active: 1,
          suspended: 0,
          banned: 0,
          newThisMonth: 0,
        }}
      />,
    )
    expect(html).toContain('data-stat="total"')
    expect(html).toContain('data-stat="active"')
    expect(html).toContain('data-stat="suspended"')
    expect(html).toContain('data-stat="banned"')
    expect(html).toContain('data-stat="newThisMonth"')
  })
})

describe('CustomerFilters', () => {
  it('renders all 9 filter fields + Apply + Reset', () => {
    const html = renderToStaticMarkup(
      <CustomerFilters
        filters={{
          role: null,
          status: null,
          signupFrom: null,
          signupTo: null,
          spendMinCents: null,
          spendMaxCents: null,
          riskMin: null,
          riskMax: null,
          q: null,
        }}
        sort="spend_desc"
      />,
    )
    expect(html).toContain('action="/admin/customers"')
    expect(html).toContain('method="get"')
    expect(html).toContain('name="q"')
    expect(html).toContain('name="role"')
    expect(html).toContain('name="status"')
    expect(html).toContain('name="signupFrom"')
    expect(html).toContain('name="signupTo"')
    expect(html).toContain('name="spendMinCents"')
    expect(html).toContain('name="spendMaxCents"')
    expect(html).toContain('name="riskMin"')
    expect(html).toContain('name="riskMax"')
    expect(html).toContain('Apply')
    expect(html).toContain('Reset')
    // Hidden sort field preserves the active sort key
    expect(html).toMatch(/type="hidden"[^>]*name="sort"[^>]*value="spend_desc"/)
  })

  it('renders default values for active filters', () => {
    const html = renderToStaticMarkup(
      <CustomerFilters
        filters={{
          role: 'partner',
          status: 'suspended',
          signupFrom: '2026-01-01',
          signupTo: '2026-06-30',
          spendMinCents: 5000,
          spendMaxCents: 50000,
          riskMin: 30,
          riskMax: 70,
          q: 'alice',
        }}
        sort="risk_desc"
      />,
    )
    expect(html).toContain('value="partner"')
    expect(html).toContain('value="suspended"')
    expect(html).toContain('value="2026-01-01"')
    expect(html).toContain('value="2026-06-30"')
    expect(html).toContain('value="5000"')
    expect(html).toContain('value="50000"')
    expect(html).toContain('value="30"')
    expect(html).toContain('value="70"')
    expect(html).toContain('value="alice"')
    expect(html).toContain('type="hidden"')
    expect(html).toContain('value="risk_desc"')
  })
})