// getAnalyticsKpi.test.ts — unit tests for the aggregate reducer +
// the query wrapper. Pure-function tests for the reducer are
// exhaustive; the query wrapper is tested via mocks of the Supabase
// + guards layer.

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the foundations layer so we can control auth + supabase + logger
// without pulling real env vars.
vi.mock('@foundations/auth/guards', () => ({
  requireRole: vi.fn(async () => undefined),
}))

const mockSelect = vi.fn()
const mockEq = vi.fn()
const mockIs = vi.fn()
const mockGte = vi.fn()
const mockLte = vi.fn()
const mockFrom = vi.fn()

// The supabase query chain is thenable so the destructure { data, error }
// at the end of the await works.
function buildChainResult(data: unknown, error: unknown = null) {
  return { data, error }
}

vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: vi.fn(async () => ({
    from: mockFrom,
  })),
}))

vi.mock('@foundations/log/pino', () => ({
  loggerFor: vi.fn(() => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}))

import { aggregateKpi, getAnalyticsKpi } from './getAnalyticsKpi'
import { EMPTY_ANALYTICS_KPI, type AnalyticsRange } from '../types'

const TEST_RANGE: AnalyticsRange = {
  kind: 'preset',
  preset: '30d',
  fromIso: '2026-06-02',
  toIso: '2026-07-01',
  days: 30,
}

function wireChain(result: { data: unknown; error: unknown }) {
  // Each chained method returns the next link in the chain, AND the
  // final awaited value resolves to the supplied result.
  mockSelect.mockReturnValue({ eq: mockEq })
  mockEq.mockReturnValue({ is: mockIs })
  mockIs.mockReturnValue({ gte: mockGte })
  mockGte.mockReturnValue({ lte: mockLte })
  mockLte.mockResolvedValue(result)
  mockFrom.mockReturnValue({ select: mockSelect })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('aggregateKpi (pure reducer)', () => {
  it('returns zeros for empty input', () => {
    expect(aggregateKpi([])).toEqual(EMPTY_ANALYTICS_KPI)
  })

  it('sums revenue / orders / signups across rows', () => {
    const out = aggregateKpi([
      {
        date: '2026-07-01',
        revenue_cents: 1_000_00,
        order_count: 5,
        refund_count: 0,
        chargeback_count: 0,
        signup_count: 3,
        visitor_count: 200,
      },
      {
        date: '2026-06-30',
        revenue_cents: 2_500_00,
        order_count: 10,
        refund_count: 1,
        chargeback_count: 0,
        signup_count: 4,
        visitor_count: 350,
      },
    ])
    expect(out.totalRevenueCents).toBe(350_000)
    expect(out.totalOrders).toBe(15)
    expect(out.newSignups).toBe(7)
  })

  it('computes refund rate as percent of orders', () => {
    const out = aggregateKpi([
      {
        date: '2026-07-01',
        revenue_cents: 0,
        order_count: 100,
        refund_count: 5,
        chargeback_count: 0,
        signup_count: 0,
        visitor_count: 0,
      },
    ])
    expect(out.refundRatePct).toBe(5)
  })

  it('computes chargeback rate as percent of orders', () => {
    const out = aggregateKpi([
      {
        date: '2026-07-01',
        revenue_cents: 0,
        order_count: 200,
        refund_count: 0,
        chargeback_count: 2,
        signup_count: 0,
        visitor_count: 0,
      },
    ])
    expect(out.chargebackRatePct).toBe(1)
  })

  it('computes conversion rate (visitor → purchase) as percent', () => {
    const out = aggregateKpi([
      {
        date: '2026-07-01',
        revenue_cents: 0,
        order_count: 25,
        refund_count: 0,
        chargeback_count: 0,
        signup_count: 0,
        visitor_count: 1000,
      },
    ])
    expect(out.conversionRatePct).toBe(2.5)
  })

  it('handles zero orders (no division by zero)', () => {
    const out = aggregateKpi([
      {
        date: '2026-07-01',
        revenue_cents: 0,
        order_count: 0,
        refund_count: 0,
        chargeback_count: 0,
        signup_count: 0,
        visitor_count: 0,
      },
    ])
    expect(out.refundRatePct).toBe(0)
    expect(out.chargebackRatePct).toBe(0)
    expect(out.conversionRatePct).toBe(0)
  })

  it('handles zero visitors (no division by zero)', () => {
    const out = aggregateKpi([
      {
        date: '2026-07-01',
        revenue_cents: 0,
        order_count: 5,
        refund_count: 0,
        chargeback_count: 0,
        signup_count: 0,
        visitor_count: 0,
      },
    ])
    expect(out.conversionRatePct).toBe(0)
  })

  it('coerces bigint-as-string values (PostgREST serialization)', () => {
    const out = aggregateKpi([
      {
        date: '2026-07-01',
        revenue_cents: '50000',
        order_count: '7',
        refund_count: '1',
        chargeback_count: '0',
        signup_count: '3',
        visitor_count: '100',
      },
    ])
    expect(out.totalRevenueCents).toBe(50_000)
    expect(out.totalOrders).toBe(7)
    expect(out.refundRatePct).toBeCloseTo(100 / 7, 2)
  })

  it('coerces nulls to zero (defensive)', () => {
    const out = aggregateKpi([
      {
        date: '2026-07-01',
        revenue_cents: null,
        order_count: null,
        refund_count: null,
        chargeback_count: null,
        signup_count: null,
        visitor_count: null,
      },
    ])
    expect(out).toEqual(EMPTY_ANALYTICS_KPI)
  })

  it('clamps negative numbers to zero (defensive)', () => {
    const out = aggregateKpi([
      {
        date: '2026-07-01',
        revenue_cents: -100,
        order_count: -5,
        refund_count: 0,
        chargeback_count: 0,
        signup_count: 0,
        visitor_count: 0,
      },
    ])
    expect(out.totalRevenueCents).toBe(0)
    expect(out.totalOrders).toBe(0)
  })

  it('rounds percentages to 2 decimal places', () => {
    // 1 order, 1 refund → 100.0%
    const out = aggregateKpi([
      {
        date: '2026-07-01',
        revenue_cents: 0,
        order_count: 3,
        refund_count: 1,
        chargeback_count: 0,
        signup_count: 0,
        visitor_count: 0,
      },
    ])
    // 1 / 3 = 33.333...% → rounds to 33.33
    expect(out.refundRatePct).toBe(33.33)
  })
})

describe('getAnalyticsKpi (query wrapper)', () => {
  it('calls requireRole(["admin","super_admin"])', async () => {
    const { requireRole } = await import('@foundations/auth/guards')
    wireChain(buildChainResult([], null))
    await getAnalyticsKpi(TEST_RANGE)
    expect(requireRole).toHaveBeenCalledWith(['admin', 'super_admin'])
  })

  it('queries analytics_daily with the correct filters', async () => {
    wireChain(buildChainResult([], null))
    await getAnalyticsKpi(TEST_RANGE)
    expect(mockFrom).toHaveBeenCalledWith('analytics_daily')
    expect(mockSelect).toHaveBeenCalledWith(
      'date, revenue_cents, order_count, refund_count, chargeback_count, signup_count, visitor_count',
    )
    expect(mockEq).toHaveBeenCalledWith('dimension_kind', 'all')
    expect(mockIs).toHaveBeenCalledWith('dimension_id', null)
    expect(mockGte).toHaveBeenCalledWith('date', '2026-06-02')
    expect(mockLte).toHaveBeenCalledWith('date', '2026-07-01')
  })

  it('returns the empty shape when the table has no rows (pre-job state)', async () => {
    wireChain(buildChainResult([], null))
    const out = await getAnalyticsKpi(TEST_RANGE)
    expect(out).toEqual(EMPTY_ANALYTICS_KPI)
  })

  it('returns the empty shape on DB error (fail-soft)', async () => {
    wireChain(buildChainResult(null, { message: 'relation does not exist' }))
    const out = await getAnalyticsKpi(TEST_RANGE)
    expect(out).toEqual(EMPTY_ANALYTICS_KPI)
  })

  it('returns the empty shape when data is null', async () => {
    wireChain(buildChainResult(null, null))
    const out = await getAnalyticsKpi(TEST_RANGE)
    expect(out).toEqual(EMPTY_ANALYTICS_KPI)
  })

  it('aggregates the rows into the 6-KPI shape on happy path', async () => {
    wireChain(
      buildChainResult([
        {
          date: '2026-07-01',
          revenue_cents: 1_000_00,
          order_count: 5,
          refund_count: 0,
          chargeback_count: 0,
          signup_count: 3,
          visitor_count: 200,
        },
        {
          date: '2026-06-30',
          revenue_cents: 2_500_00,
          order_count: 10,
          refund_count: 1,
          chargeback_count: 0,
          signup_count: 4,
          visitor_count: 350,
        },
      ]),
    )
    const out = await getAnalyticsKpi(TEST_RANGE)
    expect(out.totalRevenueCents).toBe(350_000)
    expect(out.totalOrders).toBe(15)
    expect(out.newSignups).toBe(7)
  })

  it('PII safety: the query select payload does not include email/name columns', async () => {
    wireChain(buildChainResult([], null))
    await getAnalyticsKpi(TEST_RANGE)
    const selectArg = mockSelect.mock.calls[0]![0] as string
    expect(selectArg).not.toMatch(/email|name|ip|user_agent|address/i)
  })
})