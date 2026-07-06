// getMiniShop.test.ts — P13.8 public minishop query tests.
//
// Coverage (per the spec acceptance criteria + the page's data shape):
//   - Null return when handle is empty / whitespace
//   - Null return when the affiliates row doesn't exist
//   - Null return when the affiliates row read errors
//   - Null return when the affiliate is pending / suspended
//     (only 'approved' reaches the page)
//   - Happy path: aggregator returns all fields, bigint coerced
//   - Fail-soft: profile read error doesn't kill the result
//   - Fail-soft: commissions read error doesn't kill the result
//   - Fail-soft: clicks count error doesn't kill the result
//   - Fail-soft: reviews read error doesn't kill the result
//   - Defensive narrowing: malformed curated rows are dropped
//   - Filter unpublished products from the curated set (status !=
//     'published' rows are dropped at the page layer)
//   - Featured + recency sort: is_featured=true first, then added_at desc
//   - Lifetime earned sums across multiple non-reversed commissions
//   - Avg rating computed only across reviews on curated products
//   - PII safety: no raw handle / user_id / email in log payloads
//
// All Supabase calls are mocked — pure unit test.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- mock the supabase + logger modules -----------------------------------

const mockGetServerSupabase = vi.fn()
const mockWarn = vi.fn()

vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: () => mockGetServerSupabase(),
}))

vi.mock('@foundations/log/pino', () => ({
  loggerFor: () => ({ warn: mockWarn }),
}))

beforeEach(() => {
  vi.resetModules()
  mockGetServerSupabase.mockReset()
  mockWarn.mockReset()
})

// --- helpers --------------------------------------------------------------

type AffiliateRaw = Record<string, unknown>
type CuratedRaw = Record<string, unknown>

function makeAffiliateChain(args: { data: AffiliateRaw | null; error: unknown }) {
  const state: { data: AffiliateRaw | null; error: unknown } = {
    data: args.data,
    error: args.error,
  }
  const builder: Record<string, unknown> = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    neq: vi.fn(() => builder),
    gte: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    maybeSingle: vi.fn(() => Promise.resolve({ data: state.data, error: state.error })),
  }
  return builder
}

function makeListChain(args: { data: ReadonlyArray<CuratedRaw>; error: unknown }) {
  const state: { data: ReadonlyArray<CuratedRaw>; error: unknown } = {
    data: args.data,
    error: args.error,
  }
  /** The promise every awaited chain resolves to. */
  const resolvedPromise = () =>
    Promise.resolve({ data: state.data, error: state.error })
  /** Build a chainable that resolves to `state` whenever the
   *  Supabase client awaits it (via .then) OR when a terminal
   *  method like .limit/.order/.maybeSingle is called. */
  const builder: Record<string, unknown> = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    neq: vi.fn(() => builder),
    gte: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => resolvedPromise()),
    /** The profiles table in the `getMiniShop` read uses
     *  `.maybeSingle()` for the `.eq('id', userId)` lookup, so
     *  the same chain must support it. We return the first row
     *  of the array (mirroring how PostgREST returns a single
     *  row from maybeSingle) or null when the array is empty. */
    maybeSingle: vi.fn(() =>
      Promise.resolve({
        data: state.data[0] ?? null,
        error: state.error,
      }),
    ),
    /** The bare-await path — when `await supabase.from(...)...neq(...)`
     *  resolves (no terminal operator). Supabase chains are
     *  thenable; we emulate that. */
    then: (_onFulfilled?: unknown, _onRejected?: unknown) =>
      resolvedPromise().then(_onFulfilled as never, _onRejected as never),
  }
  return builder
}

function makeHeadCountChain(args: { count: number | null; error: unknown }) {
  const state = { count: args.count, error: args.error }
  /** The terminal promise — every awaited chain resolves to
   *  the count-bearing shape that the `select(..., { head: true,
   *  count: 'exact' })` call returns in production. */
  const terminalPromise = () =>
    Promise.resolve({ data: null, count: state.count, error: state.error })
  /** A self-referential chainable. Every chainable method returns
   *  `self` so the next method call (or a final `await`) still
   *  resolves to the terminal data. `then` is the await entry
   *  point and returns a real Promise (not a synchronous resolve
   *  call) so Promise.all's unwrap behaves correctly. */
  const self: Record<string, unknown> = {}
  self['select'] = vi.fn(() => self)
  self['eq'] = vi.fn(() => self)
  self['gte'] = vi.fn(() => self)
  self['neq'] = vi.fn(() => self)
  self['order'] = vi.fn(() => self)
  self['limit'] = vi.fn(() => self)
  self['then'] = (
    resolve: (v: { data: null; count: number | null; error: unknown }) => void,
    reject?: (e: unknown) => void,
  ) => terminalPromise().then(resolve, reject)
  return self
}

function makeFakeSupabase(args: {
  affiliatesChain: unknown
  profileChain?: unknown
  curatedChain?: unknown
  commissionsChain?: unknown
  clicksChain?: unknown
  reviewsChain?: unknown
}) {
  return {
    from: (table: string) => {
      switch (table) {
        case 'affiliates':
          return args.affiliatesChain
        case 'profiles':
          return args.profileChain ?? makeListChain({ data: [], error: null })
        case 'affiliate_curated_products':
          return args.curatedChain ?? makeListChain({ data: [], error: null })
        case 'affiliate_commissions':
          return args.commissionsChain ?? makeListChain({ data: [], error: null })
        case 'affiliate_clicks':
          return args.clicksChain ?? makeHeadCountChain({ count: 0, error: null })
        case 'reviews':
          return args.reviewsChain ?? makeListChain({ data: [], error: null })
        default:
          throw new Error(`Unexpected from(${table})`)
      }
    },
  }
}

// --- import after mocks so the module picks up the mocks ------------------

async function importFresh() {
  const mod = await import('./getMiniShop')
  return mod
}

// --- tests ----------------------------------------------------------------

describe('getMiniShop — input validation', () => {
  it('returns null for an empty handle', async () => {
    mockGetServerSupabase.mockReturnValue(makeFakeSupabase({ affiliatesChain: null }))
    const { getMiniShop } = await importFresh()
    expect(await getMiniShop('')).toBeNull()
    expect(await getMiniShop('   ')).toBeNull()
  })
})

describe('getMiniShop — affiliate row gating', () => {
  it('returns null when the affiliates row is missing', async () => {
    const chain = makeAffiliateChain({ data: null, error: null })
    mockGetServerSupabase.mockReturnValue(makeFakeSupabase({ affiliatesChain: chain }))
    const { getMiniShop } = await importFresh()
    expect(await getMiniShop('ghost')).toBeNull()
  })

  it('returns null + warns when the affiliates read errors', async () => {
    const chain = makeAffiliateChain({
      data: null,
      error: { code: 'PGRST116', message: 'db down' },
    })
    mockGetServerSupabase.mockReturnValue(makeFakeSupabase({ affiliatesChain: chain }))
    const { getMiniShop } = await importFresh()
    expect(await getMiniShop('marcus')).toBeNull()
    expect(mockWarn).toHaveBeenCalled()
    // No raw handle in the warn payload
    const arg = mockWarn.mock.calls[0]?.[0] as Record<string, unknown>
    expect(arg.handle_hash).toMatch(/^[0-9a-f]{8}$/)
    expect(JSON.stringify(arg)).not.toContain('marcus')
  })

  it('returns null when the affiliate is pending', async () => {
    const chain = makeAffiliateChain({
      data: {
        id: 1,
        handle: 'marcus',
        status: 'pending',
        user_id: '00000000-0000-0000-0000-000000000001',
        bio: null,
        brand_name: null,
        approved_at: null,
      },
      error: null,
    })
    mockGetServerSupabase.mockReturnValue(makeFakeSupabase({ affiliatesChain: chain }))
    const { getMiniShop } = await importFresh()
    expect(await getMiniShop('marcus')).toBeNull()
  })

  it('returns null when the affiliate is suspended', async () => {
    const chain = makeAffiliateChain({
      data: {
        id: 1,
        handle: 'marcus',
        status: 'suspended',
        user_id: '00000000-0000-0000-0000-000000000001',
        bio: null,
        brand_name: null,
        approved_at: null,
      },
      error: null,
    })
    mockGetServerSupabase.mockReturnValue(makeFakeSupabase({ affiliatesChain: chain }))
    const { getMiniShop } = await importFresh()
    expect(await getMiniShop('marcus')).toBeNull()
  })

  it('returns null for invalid status values (defensive narrowing)', async () => {
    const chain = makeAffiliateChain({
      data: {
        id: 1,
        handle: 'marcus',
        status: 'bogus-value',
        user_id: '00000000-0000-0000-0000-000000000001',
        bio: null,
        brand_name: null,
        approved_at: null,
      },
      error: null,
    })
    mockGetServerSupabase.mockReturnValue(makeFakeSupabase({ affiliatesChain: chain }))
    const { getMiniShop } = await importFresh()
    expect(await getMiniShop('marcus')).toBeNull()
  })
})

describe('getMiniShop — happy path', () => {
  it('returns the full aggregator with curated products + stats', async () => {
    const affChain = makeAffiliateChain({
      data: {
        id: 42,
        handle: 'marcus',
        status: 'approved',
        user_id: '00000000-0000-0000-0000-000000000001',
        bio: 'Hi! I curate the best PLR video courses for indie hackers.',
        brand_name: 'Marcus Curates',
        approved_at: '2026-05-01T00:00:00Z',
      },
      error: null,
    })
    const profileChain = makeListChain({
      data: [
        {
          display_name: 'Marcus Reyes',
          avatar_url: '/img/marcus.jpg',
          social_links: ['https://twitter.com/marcus'],
        },
      ],
      error: null,
    })
    const curatedChain = makeListChain({
      data: [
        {
          id: 100,
          product_id: 1,
          is_featured: true,
          why_i_picked_this: 'Best seller of the year',
          added_at: '2026-06-01T00:00:00Z',
          product: {
            id: 1,
            slug: 'plr-masterclass',
            title: 'PLR Masterclass',
            short_description: 'Build a resale business.',
            thumbnail_url: '/img/plr.jpg',
            status: 'published',
            pricing: [
              {
                license: 'plr',
                price_cents: '9900',
                currency: 'USD',
                is_default: true,
                is_active: true,
              },
            ],
          },
        },
        {
          id: 101,
          product_id: 2,
          is_featured: false,
          why_i_picked_this: null,
          added_at: '2026-06-15T00:00:00Z',
          product: {
            id: 2,
            slug: 'video-templates',
            title: 'Video Templates Vol. 2',
            short_description: 'Drop-in video templates.',
            thumbnail_url: null,
            status: 'published',
            pricing: [
              {
                license: 'plr',
                price_cents: '4900',
                currency: 'EUR',
                is_default: true,
                is_active: true,
              },
            ],
          },
        },
      ],
      error: null,
    })
    const commissionsChain = makeListChain({
      data: [
        { commission_cents: '12345' },
        { commission_cents: '6789' },
        { commission_cents: '0' },
      ],
      error: null,
    })
    const clicksChain = makeHeadCountChain({ count: 420, error: null })
    const reviewsChain = makeListChain({
      data: [
        { product_id: 1, rating: '4.5' },
        { product_id: 2, rating: '5.0' },
        { product_id: 999, rating: '1.0' }, // off-curated product; ignored
      ],
      error: null,
    })

    mockGetServerSupabase.mockReturnValue(
      makeFakeSupabase({
        affiliatesChain: affChain,
        profileChain,
        curatedChain,
        commissionsChain,
        clicksChain,
        reviewsChain,
      }),
    )

    const { getMiniShop } = await importFresh()
    const result = await getMiniShop('marcus')

    expect(result).not.toBeNull()
    expect(result?.affiliate.handle).toBe('marcus')
    expect(result?.affiliate.brandName).toBe('Marcus Curates')
    expect(result?.affiliate.bio).toContain('indie hackers')
    expect(result?.profile.displayName).toBe('Marcus Reyes')
    expect(result?.profile.avatarUrl).toBe('/img/marcus.jpg')
    expect(result?.profile.socialLinks).toEqual(['https://twitter.com/marcus'])
    expect(result?.curatedProducts).toHaveLength(2)
    expect(result?.curatedProducts[0]?.isFeatured).toBe(true)
    expect(result?.stats.curatedCount).toBe(2)
    expect(result?.stats.lifetimeEarnedCents).toBe(19134)
    expect(result?.stats.clicks30d).toBe(420)
    expect(result?.stats.avgRating).toBe(4.8) // (4.5 + 5.0) / 2 = 4.75 → 4.8
  })

  it('drops malformed curated rows (missing product slug or title)', async () => {
    const affChain = makeAffiliateChain({
      data: {
        id: 42,
        handle: 'marcus',
        status: 'approved',
        user_id: '00000000-0000-0000-0000-000000000001',
        bio: null,
        brand_name: null,
        approved_at: null,
      },
      error: null,
    })
    const curatedChain = makeListChain({
      data: [
        {
          id: 100,
          product_id: 1,
          is_featured: true,
          why_i_picked_this: null,
          added_at: '2026-06-01T00:00:00Z',
          product: { id: 1, slug: 'a', title: 'A', status: 'published', pricing: [] },
        },
        {
          id: 101,
          product_id: 2,
          is_featured: false,
          why_i_picked_this: null,
          added_at: '2026-06-02T00:00:00Z',
          product: { id: 2, slug: '', title: 'B', status: 'published', pricing: [] }, // empty slug → dropped
        },
        {
          id: 102,
          product_id: 3,
          is_featured: false,
          why_i_picked_this: null,
          added_at: '2026-06-03T00:00:00Z',
          product: null, // null join → dropped
        },
      ],
      error: null,
    })

    mockGetServerSupabase.mockReturnValue(
      makeFakeSupabase({ affiliatesChain: affChain, curatedChain }),
    )

    const { getMiniShop } = await importFresh()
    const result = await getMiniShop('marcus')
    expect(result?.curatedProducts).toHaveLength(1)
    expect(result?.curatedProducts[0]?.productSlug).toBe('a')
  })

  it('drops curated rows whose joined product is not published', async () => {
    const affChain = makeAffiliateChain({
      data: {
        id: 42,
        handle: 'marcus',
        status: 'approved',
        user_id: '00000000-0000-0000-0000-000000000001',
        bio: null,
        brand_name: null,
        approved_at: null,
      },
      error: null,
    })
    const curatedChain = makeListChain({
      data: [
        {
          id: 100,
          product_id: 1,
          is_featured: true,
          why_i_picked_this: null,
          added_at: '2026-06-01T00:00:00Z',
          product: {
            id: 1,
            slug: 'pub',
            title: 'Published',
            status: 'published',
            pricing: [],
          },
        },
        {
          id: 101,
          product_id: 2,
          is_featured: false,
          why_i_picked_this: null,
          added_at: '2026-06-02T00:00:00Z',
          product: {
            id: 2,
            slug: 'drf',
            title: 'Draft Product',
            status: 'draft', // ← not published; dropped from page
            pricing: [],
          },
        },
      ],
      error: null,
    })

    mockGetServerSupabase.mockReturnValue(
      makeFakeSupabase({ affiliatesChain: affChain, curatedChain }),
    )

    const { getMiniShop } = await importFresh()
    const result = await getMiniShop('marcus')
    expect(result?.curatedProducts).toHaveLength(1)
    expect(result?.curatedProducts[0]?.productSlug).toBe('pub')
  })
})

describe('getMiniShop — fail-soft reads', () => {
  it('profile read error → empty profile, no crash', async () => {
    const affChain = makeAffiliateChain({
      data: {
        id: 42,
        handle: 'marcus',
        status: 'approved',
        user_id: '00000000-0000-0000-0000-000000000001',
        bio: null,
        brand_name: null,
        approved_at: null,
      },
      error: null,
    })
    const profileChain = makeListChain({
      data: [],
      error: { code: 'PGRST116', message: 'profile down' },
    })

    mockGetServerSupabase.mockReturnValue(
      makeFakeSupabase({ affiliatesChain: affChain, profileChain }),
    )
    const { getMiniShop } = await importFresh()
    const result = await getMiniShop('marcus')
    expect(result).not.toBeNull()
    expect(result?.profile.displayName).toBe('')
    expect(mockWarn).toHaveBeenCalled()
  })

  it('commissions read error → lifetime_earned_cents defaults to 0', async () => {
    const affChain = makeAffiliateChain({
      data: {
        id: 42,
        handle: 'marcus',
        status: 'approved',
        user_id: '00000000-0000-0000-0000-000000000001',
        bio: null,
        brand_name: null,
        approved_at: null,
      },
      error: null,
    })
    const commissionsChain = makeListChain({
      data: [],
      error: { code: 'PGRST116', message: 'commissions down' },
    })

    mockGetServerSupabase.mockReturnValue(
      makeFakeSupabase({ affiliatesChain: affChain, commissionsChain }),
    )
    const { getMiniShop } = await importFresh()
    const result = await getMiniShop('marcus')
    expect(result?.stats.lifetimeEarnedCents).toBe(0)
  })

  it('clicks read error → clicks30d defaults to 0', async () => {
    const affChain = makeAffiliateChain({
      data: {
        id: 42,
        handle: 'marcus',
        status: 'approved',
        user_id: '00000000-0000-0000-0000-000000000001',
        bio: null,
        brand_name: null,
        approved_at: null,
      },
      error: null,
    })
    const clicksChain = makeHeadCountChain({
      count: null,
      error: { code: 'PGRST116', message: 'clicks down' },
    })

    mockGetServerSupabase.mockReturnValue(
      makeFakeSupabase({ affiliatesChain: affChain, clicksChain }),
    )
    const { getMiniShop } = await importFresh()
    const result = await getMiniShop('marcus')
    expect(result?.stats.clicks30d).toBe(0)
  })

  it('reviews read error → avgRating defaults to null', async () => {
    const affChain = makeAffiliateChain({
      data: {
        id: 42,
        handle: 'marcus',
        status: 'approved',
        user_id: '00000000-0000-0000-0000-000000000001',
        bio: null,
        brand_name: null,
        approved_at: null,
      },
      error: null,
    })
    const reviewsChain = makeListChain({
      data: [],
      error: { code: 'PGRST116', message: 'reviews down' },
    })

    mockGetServerSupabase.mockReturnValue(
      makeFakeSupabase({ affiliatesChain: affChain, reviewsChain }),
    )
    const { getMiniShop } = await importFresh()
    const result = await getMiniShop('marcus')
    expect(result?.stats.avgRating).toBeNull()
  })
})

describe('getMiniShop — bigint coercion + shape', () => {
  it('coerces commission cents strings to finite non-negative numbers', async () => {
    const affChain = makeAffiliateChain({
      data: {
        id: 42,
        handle: 'marcus',
        status: 'approved',
        user_id: '00000000-0000-0000-0000-000000000001',
        bio: null,
        brand_name: null,
        approved_at: null,
      },
      error: null,
    })
    const commissionsChain = makeListChain({
      data: [
        { commission_cents: '12345678901234' }, // bigint as string
        { commission_cents: '998' },
        { commission_cents: 'not-a-number' }, // NaN string → coerced to 0
      ],
      error: null,
    })

    mockGetServerSupabase.mockReturnValue(
      makeFakeSupabase({ affiliatesChain: affChain, commissionsChain }),
    )
    const { getMiniShop } = await importFresh()
    const result = await getMiniShop('marcus')
    // 12345678901234 + 998 + 0 = 12345678902232
    expect(result?.stats.lifetimeEarnedCents).toBe(12345678902232)
  })
})

describe('getMiniShop — PII safety in logs', () => {
  it('does not log raw handle / user_id / affiliate_id', async () => {
    const affChain = makeAffiliateChain({
      data: null,
      error: { code: 'PGRST116', message: 'db down' },
    })
    mockGetServerSupabase.mockReturnValue(makeFakeSupabase({ affiliatesChain: affChain }))
    const { getMiniShop } = await importFresh()
    await getMiniShop('handle-with-pii-test')
    expect(mockWarn).toHaveBeenCalled()
    const allArgs = JSON.stringify(mockWarn.mock.calls)
    expect(allArgs).not.toContain('handle-with-pii-test')
    expect(allArgs).toMatch(/handle_hash/)
  })

  it('does not log raw affiliate_id on profile warn', async () => {
    const affChain = makeAffiliateChain({
      data: {
        id: 999,
        handle: 'marcus',
        status: 'approved',
        user_id: '00000000-0000-0000-0000-000000000001',
        bio: null,
        brand_name: null,
        approved_at: null,
      },
      error: null,
    })
    const profileChain = makeListChain({
      data: [],
      error: { code: 'PGRST116', message: 'profile down' },
    })

    mockGetServerSupabase.mockReturnValue(
      makeFakeSupabase({ affiliatesChain: affChain, profileChain }),
    )
    mockWarn.mockClear()
    const { getMiniShop } = await importFresh()
    await getMiniShop('marcus')
    expect(mockWarn).toHaveBeenCalled()
    const allArgs = JSON.stringify(mockWarn.mock.calls)
    expect(allArgs).not.toContain('999')
    expect(allArgs).toMatch(/affiliate_id_hash/)
  })
})

describe('getMiniShop — 0 curated products', () => {
  it('returns an empty curatedProducts array (page renders "Coming soon")', async () => {
    const affChain = makeAffiliateChain({
      data: {
        id: 42,
        handle: 'marcus',
        status: 'approved',
        user_id: '00000000-0000-0000-0000-000000000001',
        bio: null,
        brand_name: null,
        approved_at: null,
      },
      error: null,
    })
    const curatedChain = makeListChain({ data: [], error: null })

    mockGetServerSupabase.mockReturnValue(
      makeFakeSupabase({ affiliatesChain: affChain, curatedChain }),
    )
    const { getMiniShop } = await importFresh()
    const result = await getMiniShop('marcus')
    expect(result?.curatedProducts).toHaveLength(0)
    expect(result?.stats.curatedCount).toBe(0)
  })
})
