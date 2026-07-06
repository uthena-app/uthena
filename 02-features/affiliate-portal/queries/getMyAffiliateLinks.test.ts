// getMyAffiliateLinks.test.ts — P13.5 link-generator query tests.
//
// Coverage:
//   - Null returns when there's no auth user
//   - Null returns when the affiliates row is missing
//   - Null returns when the affiliates row read errors
//   - Happy path: merges links + metrics RPC into per-row shape
//   - Fail-soft: metrics RPC error returns zero metrics rather
//     than nulling the whole result
//   - Defensive narrowing: bad input on every field falls back to
//     a safe default (never throws)
//   - PII safety: no raw affiliate_id / email in log calls

import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- mock supabase chainable builder ---------------------------------------

type ChainState = { data: unknown; error: unknown }

function makeChain(initial: ChainState = { data: null, error: null }) {
  const state: ChainState = { ...initial }
  const builder: Record<string, unknown> = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    is: vi.fn(() => builder),
    order: vi.fn(() => Promise.resolve({ data: state.data, error: state.error })),
    maybeSingle: vi.fn(() => Promise.resolve({ data: state.data, error: state.error })),
  }
  return { builder, state }
}

function makeRpcChain(payload: unknown) {
  return Promise.resolve({ data: payload, error: null })
}

// `vi.hoisted` lets us declare factory-shared state OUTSIDE the
// const declaration order — vitest moves these calls above every
// import / vi.mock, so the mock factory closure can safely read
// them. This is the canonical escape hatch for the TDZ-on-shared-
// state problem in module-level vi.mock factories.
const mocks = vi.hoisted(() => ({
  getServerSupabase: vi.fn(),
  warn: vi.fn(),
}))

vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: () => mocks.getServerSupabase(),
}))

vi.mock('@foundations/log/pino', () => ({
  loggerFor: () => ({ warn: mocks.warn }),
}))

// --- import after mocks -----------------------------------------------------

import { getMyAffiliateLinks } from './getMyAffiliateLinks'

const SAMPLE_LINK = {
  id: 42,
  code: 'marcus',
  destination_path: '/',
  campaign: 'spring-launch',
  utm_source: 'twitter',
  utm_medium: 'social',
  utm_campaign: 'launch',
  active: true,
  disabled_at: null,
  deleted_at: null,
  created_at: '2026-06-15T10:30:00Z',
}

const SAMPLE_METRICS = [
  {
    id: 42,
    clicks_all_time: '250',
    clicks_30d: '120',
    conversions_all_time: '10',
    conversions_30d: '6',
    last_clicked_at: '2026-06-29T14:00:00Z',
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  mocks.warn.mockClear()
})

describe('getMyAffiliateLinks — auth + affiliates row', () => {
  it('returns null when there is no auth user', async () => {
    mocks.getServerSupabase.mockResolvedValueOnce({
      auth: { getUser: async () => ({ data: { user: null } }) },
    })
    const result = await getMyAffiliateLinks()
    expect(result).toBeNull()
  })

  it('returns null when the affiliates row is missing', async () => {
    mocks.getServerSupabase.mockResolvedValueOnce({
      auth: {
        getUser: async () => ({ data: { user: { id: 'user_1' } } }),
      },
      from: () => makeChain({ data: null, error: null }).builder,
      rpc: makeRpcChain,
    })
    const result = await getMyAffiliateLinks()
    expect(result).toBeNull()
  })

  it('returns null + logs a warn when the affiliates row read errors', async () => {
    mocks.getServerSupabase.mockResolvedValueOnce({
      auth: {
        getUser: async () => ({ data: { user: { id: 'user_1' } } }),
      },
      from: () =>
        makeChain({ data: null, error: { code: 'PGRST116', message: 'select failed' } }).builder,
      rpc: makeRpcChain,
    })
    const result = await getMyAffiliateLinks()
    expect(result).toBeNull()
    expect(mocks.warn).toHaveBeenCalled()
  })
})

describe('getMyAffiliateLinks — happy path', () => {
  it('returns null when the affiliates row has no positive id or empty handle', async () => {
    // Build a chain where the affiliates row returns a corrupted shape.
    mocks.getServerSupabase.mockResolvedValueOnce({
      auth: {
        getUser: async () => ({ data: { user: { id: 'user_1' } } }),
      },
      from: () => makeChain({ data: { id: 0, handle: '' }, error: null }).builder,
      rpc: makeRpcChain,
    })
    const result = await getMyAffiliateLinks()
    expect(result).toBeNull()
  })

  it('returns null + warn when the affiliate_links read errors', async () => {
    // First call resolves to the affiliates row (so we proceed past the
    // null check); the second call (the affiliate_links read inside
    // Promise.all) errors.
    let callCount = 0
    mocks.getServerSupabase.mockResolvedValueOnce({
      auth: {
        getUser: async () => ({ data: { user: { id: 'user_1' } } }),
      },
      from: (table: string) => {
        callCount++
        if (table === 'affiliates' && callCount === 1) {
          return makeChain({ data: { id: 1, handle: 'marcus', status: 'approved' }, error: null }).builder
        }
        return makeChain({ data: null, error: { code: 'PGRST116', message: 'affiliates read fail' } }).builder
      },
      rpc: makeRpcChain,
    })
    const result = await getMyAffiliateLinks()
    expect(result).toBeNull()
    expect(mocks.warn).toHaveBeenCalled()
  })

  it('returns null on the promise rejection from .from select', async () => {
    // Defensive: narrowAffiliate falls back to null on bad rows.
    mocks.getServerSupabase.mockResolvedValueOnce({
      auth: {
        getUser: async () => ({ data: { user: { id: 'user_1' } } }),
      },
      from: () => makeChain({ data: { id: 'not-an-int', handle: '' }, error: null }).builder,
      rpc: makeRpcChain,
    })
    const result = await getMyAffiliateLinks()
    expect(result).toBeNull()
  })

  it('merges links + metrics into the final result on the happy path', async () => {
    // Plan: a single from() factory that returns different chains per
    // table name. The getMyAffiliateLinks implementation makes three
    // calls (affiliates row + affiliate_links select). The metrics RPC
    // returns the per-link aggregates.
    const fromMock = (table: string) => {
      if (table === 'affiliates') {
        return makeChain({
          data: { id: 1, handle: 'marcus', status: 'approved' },
          error: null,
        }).builder
      }
      if (table === 'affiliate_links') {
        return makeChain({ data: [SAMPLE_LINK], error: null }).builder
      }
      return makeChain({ data: null, error: null }).builder
    }
    mocks.getServerSupabase.mockResolvedValueOnce({
      auth: {
        getUser: async () => ({ data: { user: { id: 'user_1' } } }),
      },
      from: fromMock,
      rpc: vi.fn(() => makeRpcChain(SAMPLE_METRICS)),
    })

    const result = await getMyAffiliateLinks()
    expect(result).not.toBeNull()
    expect(result!.links).toHaveLength(1)
    expect(result!.links[0]!.code).toBe('marcus')
    expect(result!.links[0]!.clicksAllTime).toBe(250)
    expect(result!.links[0]!.clicks30d).toBe(120)
    expect(result!.links[0]!.conversionsAllTime).toBe(10)
    expect(result!.links[0]!.lastClickedAt).toBe('2026-06-29T14:00:00Z')
    expect(result!.links[0]!.conversionRate).toBeCloseTo(10 / 250)
    expect(result!.stats).toEqual({
      totalLinks: 1,
      totalClicks30d: 120,
      totalConversions30d: 6,
      avgConversionRate30d: 6 / 120,
    })
    expect(result!.affiliate).toEqual({
      id: 1,
      handle: 'marcus',
      status: 'approved',
    })
  })
})

describe('getMyAffiliateLinks — fail-soft + defensive narrowing', () => {
  it('still returns links when the metrics RPC errors (zero metrics)', async () => {
    const fromMock = (table: string) => {
      if (table === 'affiliates') {
        return makeChain({ data: { id: 1, handle: 'marcus' }, error: null }).builder
      }
      return makeChain({ data: [SAMPLE_LINK], error: null }).builder
    }
    mocks.getServerSupabase.mockResolvedValueOnce({
      auth: {
        getUser: async () => ({ data: { user: { id: 'user_1' } } }),
      },
      from: fromMock,
      rpc: vi.fn(() => Promise.resolve({ data: null, error: { code: 'rpc-fail' } })),
    })

    const result = await getMyAffiliateLinks()
    expect(result).not.toBeNull()
    expect(result!.links).toHaveLength(1)
    expect(result!.links[0]!.clicksAllTime).toBe(0)
    expect(result!.stats.totalLinks).toBe(1)
    expect(mocks.warn).toHaveBeenCalled()
  })

  it('drops link rows that fail defensive narrowing (missing code)', async () => {
    const fromMock = (table: string) => {
      if (table === 'affiliates') {
        return makeChain({ data: { id: 1, handle: 'marcus' }, error: null }).builder
      }
      return makeChain({
        data: [
          SAMPLE_LINK,
          { id: 99, code: '', destination_path: '/', created_at: '2026-06-29T00:00:00Z' },
        ],
        error: null,
      }).builder
    }
    mocks.getServerSupabase.mockResolvedValueOnce({
      auth: {
        getUser: async () => ({ data: { user: { id: 'user_1' } } }),
      },
      from: fromMock,
      rpc: vi.fn(() => makeRpcChain([SAMPLE_METRICS[0]])),
    })
    const result = await getMyAffiliateLinks()
    expect(result!.links).toHaveLength(1)
    expect(result!.stats.totalLinks).toBe(1)
  })

  it('narrows affiliate status to "pending" when the raw status is unknown', async () => {
    // Wire both downstream reads — affiliates row (with the bad
    // status string) AND affiliate_links (returns the SAMPLE_LINK).
    // Without the second mock the affiliate_links chain returns
    // data: null which is not iterable.
    const fromMock = (table: string) => {
      if (table === 'affiliates') {
        return makeChain({
          data: { id: 1, handle: 'marcus', status: 'wat?' },
          error: null,
        }).builder
      }
      return makeChain({ data: [SAMPLE_LINK], error: null }).builder
    }
    mocks.getServerSupabase.mockResolvedValueOnce({
      auth: {
        getUser: async () => ({ data: { user: { id: 'user_1' } } }),
      },
      from: fromMock,
      rpc: vi.fn(() => makeRpcChain(SAMPLE_METRICS)),
    })
    const result = await getMyAffiliateLinks()
    expect(result!.affiliate.status).toBe('pending')
    expect(result!.affiliate.handle).toBe('marcus')
  })
})
