// CourseSalesSummary.test.tsx — structural unit tests for the
// P12.11 Slice 1 sales summary card on the partner course detail
// page (Sales tab).
//
// Strategy: renderToStaticMarkup so the tests stay fast + pure, no
// DOM env needed (vitest runs in `node` env — see vitest.config.ts).
// Matches the Stepper / Toast / RefundForm / ReviewsSection pattern.
// The data-testid markers in the component make it easy to assert
// the per-stat values without coupling to the exact label text.
//
// Coverage:
//   - Header renders the "Lifetime sales" h2 + the lead paragraph.
//   - 4 stat cards always render (Revenue, Units sold, Refund rate,
//     Average rating).
//   - Default-strip testids for each card's value.
//   - Refund rate formatting: (rate * 100).toFixed(1) + "%".
//   - "No reviews yet" copy for products with no published reviews.
//   - "No sales recorded" footer copy + "View full sales table →"
//     drill-down link with the correct productId in the href.
//   - Refund hint shows count of refunds over total orders.
//   - "No refunds on this product" hint when refundCount=0 +
//     orderCount>0.
//   - "No orders to compare" when orderCount=0.
//   - First-sale + last-sale footer lines render when lastSaleAt is
//     present.

import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { CourseSalesSummary } from './CourseSalesSummary'
import type { PartnerCourseSalesSummary } from '../queries/getMyCourseSalesSummary'

const PRODUCT_ID = 9001

function summary(overrides: Partial<PartnerCourseSalesSummary> = {}): PartnerCourseSalesSummary {
  return {
    revenueCents: 1_250_000,
    unitsSold: 50,
    orderCount: 40,
    refundCount: 3,
    refundRate: 3 / 40,
    avgRating: 4.5,
    firstSaleAt: '2026-01-15T10:00:00.000Z',
    lastSaleAt: '2026-06-29T15:30:00.000Z',
    ...overrides,
  }
}

describe('CourseSalesSummary — header + cards layout', () => {
  it('renders the Lifetime sales heading + lead copy', () => {
    const html = renderToStaticMarkup(
      createElement(CourseSalesSummary, { productId: PRODUCT_ID, summary: summary() }),
    )
    expect(html).toContain('Lifetime sales')
    expect(html).toContain('Lifetime aggregates for this product.')
  })

  it('renders the 4 stat cards in the same order as the spec (Revenue, Units, Refund rate, Avg rating)', () => {
    const html = renderToStaticMarkup(
      createElement(CourseSalesSummary, { productId: PRODUCT_ID, summary: summary() }),
    )
    expect(html).toContain('>Revenue<')
    expect(html).toContain('>Units sold<')
    expect(html).toContain('>Refund rate<')
    expect(html).toContain('>Average rating<')
  })

  it('renders the testids for each stat value', () => {
    const html = renderToStaticMarkup(
      createElement(CourseSalesSummary, { productId: PRODUCT_ID, summary: summary() }),
    )
    expect(html).toContain('data-testid="course-sales-revenue"')
    expect(html).toContain('data-testid="course-sales-units"')
    expect(html).toContain('data-testid="course-sales-refund-rate"')
    expect(html).toContain('data-testid="course-sales-avg-rating"')
  })
})

describe('CourseSalesSummary — formatting', () => {
  it('formats revenue as $12,500.00 (USD, two decimals, thousand-grouping)', () => {
    const html = renderToStaticMarkup(
      createElement(CourseSalesSummary, {
        productId: PRODUCT_ID,
        summary: summary({ revenueCents: 1_250_000 }),
      }),
    )
    expect(html).toContain('$12,500.00')
  })

  it('formats units with thousand-grouping (en-US locale)', () => {
    const html = renderToStaticMarkup(
      createElement(CourseSalesSummary, {
        productId: PRODUCT_ID,
        summary: summary({ unitsSold: 12_345 }),
      }),
    )
    expect(html).toContain('12,345')
  })

  it('formats refund rate as a one-decimal percentage', () => {
    const html = renderToStaticMarkup(
      createElement(CourseSalesSummary, {
        productId: PRODUCT_ID,
        summary: summary({ orderCount: 100, refundCount: 7, refundRate: 7 / 100 }),
      }),
    )
    expect(html).toContain('7.0%')
  })

  it('formats avg rating as "X.XX / 5"', () => {
    const html = renderToStaticMarkup(
      createElement(CourseSalesSummary, {
        productId: PRODUCT_ID,
        summary: summary({ avgRating: 4.5 }),
      }),
    )
    expect(html).toContain('4.50 / 5')
  })

  it('renders "No reviews yet" when avgRating is null', () => {
    const html = renderToStaticMarkup(
      createElement(CourseSalesSummary, {
        productId: PRODUCT_ID,
        summary: summary({ avgRating: null }),
      }),
    )
    expect(html).toContain('No reviews yet')
    expect(html).not.toContain('/ 5')
  })

  it('renders $0.00 + 0 for an empty summary', () => {
    const html = renderToStaticMarkup(
      createElement(CourseSalesSummary, {
        productId: PRODUCT_ID,
        summary: {
          revenueCents: 0,
          unitsSold: 0,
          orderCount: 0,
          refundCount: 0,
          refundRate: 0,
          avgRating: null,
          firstSaleAt: null,
          lastSaleAt: null,
        },
      }),
    )
    expect(html).toContain('$0.00')
    expect(html).toContain('No paid orders yet')
    expect(html).toContain('No reviews yet')
    expect(html).toContain('No sales recorded')
  })
})

describe('CourseSalesSummary — refund rate hints', () => {
  it('shows "N refunds of M orders" when there are refunds', () => {
    const html = renderToStaticMarkup(
      createElement(CourseSalesSummary, {
        productId: PRODUCT_ID,
        summary: summary({ orderCount: 40, refundCount: 3 }),
      }),
    )
    expect(html).toMatch(/3 refunds of 40 orders/)
  })

  it('uses "1 refund of 1 order" (singular) when counts are 1', () => {
    const html = renderToStaticMarkup(
      createElement(CourseSalesSummary, {
        productId: PRODUCT_ID,
        summary: summary({ orderCount: 1, refundCount: 1, refundRate: 1 }),
      }),
    )
    expect(html).toMatch(/1 refund of 1 order\b/)
  })

  it('shows "No refunds on this product" when there are sales but no refunds', () => {
    const html = renderToStaticMarkup(
      createElement(CourseSalesSummary, {
        productId: PRODUCT_ID,
        summary: summary({ orderCount: 5, refundCount: 0, refundRate: 0 }),
      }),
    )
    expect(html).toContain('No refunds on this product')
  })

  it('shows "No orders to compare" when there are no paid orders', () => {
    const html = renderToStaticMarkup(
      createElement(CourseSalesSummary, {
        productId: PRODUCT_ID,
        summary: {
          revenueCents: 0,
          unitsSold: 0,
          orderCount: 0,
          refundCount: 0,
          refundRate: 0,
          avgRating: null,
          firstSaleAt: null,
          lastSaleAt: null,
        },
      }),
    )
    expect(html).toContain('No orders to compare')
  })
})

describe('CourseSalesSummary — drill-down link', () => {
  it('renders a link to /partner/courses/[id]/sales with the right productId', () => {
    const html = renderToStaticMarkup(
      createElement(CourseSalesSummary, {
        productId: 4242,
        summary: summary(),
      }),
    )
    expect(html).toContain('href="/partner/courses/4242/sales"')
    expect(html).toContain('View full sales table')
    expect(html).toContain('→')
  })

  it('mentions the deferred scope (date / tier / filters / CSV) in the hint copy', () => {
    const html = renderToStaticMarkup(
      createElement(CourseSalesSummary, {
        productId: PRODUCT_ID,
        summary: summary(),
      }),
    )
    expect(html).toContain('Per-order table')
    expect(html).toContain('date / tier / status filters')
    expect(html).toContain('CSV export')
  })
})

describe('CourseSalesSummary — recency footer', () => {
  it('renders "Most recent sale" + "first sale" lines when both timestamps are present', () => {
    const html = renderToStaticMarkup(
      createElement(CourseSalesSummary, {
        productId: PRODUCT_ID,
        summary: summary({
          lastSaleAt: '2026-06-29T15:30:00.000Z',
          firstSaleAt: '2026-01-15T10:00:00.000Z',
        }),
      }),
    )
    expect(html).toContain('Most recent sale:')
    expect(html).toContain('first sale:')
  })

  it('renders "No sales recorded" muted copy when lastSaleAt is null', () => {
    const html = renderToStaticMarkup(
      createElement(CourseSalesSummary, {
        productId: PRODUCT_ID,
        summary: {
          revenueCents: 0,
          unitsSold: 0,
          orderCount: 0,
          refundCount: 0,
          refundRate: 0,
          avgRating: null,
          firstSaleAt: null,
          lastSaleAt: null,
        },
      }),
    )
    expect(html).toContain('No sales recorded')
  })

  it('renders "today" when lastSaleAt is the same calendar day as now', () => {
    // Use a real-time relative timestamp (1 hour before test run) so
    // the assertion is clock-stable regardless of when the test runs.
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const html = renderToStaticMarkup(
      createElement(CourseSalesSummary, {
        productId: PRODUCT_ID,
        summary: summary({ lastSaleAt: oneHourAgo, firstSaleAt: null }),
      }),
    )
    expect(html).toContain('Most recent sale:')
    expect(html).toContain('today')
  })
})
