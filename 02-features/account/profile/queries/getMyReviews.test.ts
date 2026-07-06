// getMyReviews.test.ts — unit tests for the two server queries that
// back /account/reviews (`getMyReviews` + `getReviewableProducts`).
// Mirrors the chainable-fake-Supabase pattern used across the
// queries test suite (getMyProfile.test.ts, getMySettings.test.ts,
// getRefundConfirmation.test.ts). Covers:
//
//   - Anon caller → [] with no DB call (defense in depth; the page
//     also gates via requireUser, but the query must hold the same
//     contract for any future direct caller).
//   - Happy path → returns the mapped shape for `MyReview` (joined
//     product pulled into `product_title` + `product_slug`) and
//     `ReviewableProduct` (joined product + joined partner pulled
//     into `product_title` + `product_slug` + `partner_name`,
//     grant source/license/granted_at pulled from the grant row).
//   - Empty result → [] (no throw; the page renders the empty state).
//   - DB error → [] (fail-soft).
//   - Defensive mapping: missing products join on the review row →
//     `(removed product)` placeholder title + null slug; missing
//     partner join on the grant row → null partner_name.
//   - Reviewable filter: products the user has already reviewed
//     (any status, including `hidden`) are excluded from the
//     "Leave a new review" list (the spec: "no existing `reviews`
//     row, any status, including deleted").
//   - RLS-friendly query shape: both queries filter by `user_id`
//     (the only policy that should ever allow these reads is the
//     self-read policy).
//   - PII safety on select: no `email`, no `ip`, no `user_agent`,
//     no password / token columns ever appear in the select payload
//     (defense in depth: even if a column is added later, this
//     explicit allowlist keeps the surface tight).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Call =
  | { method: 'select'; payload: string }
  | { method: 'eq'; col: string; val: unknown }
  | { method: 'is'; col: string; val: unknown }
  | { method: 'order'; col: string; ascending: boolean }

const calls: Call[] = []
let mockUser: { id: string; email: string | null } | null = null

// Two FIFO queues — the first await pulls from `reviewsResponseQueue`,
// the second from `grantsResponseQueue` (matches the call order in
// `getReviewableProducts`: grants → reviews → done).
let reviewsResponseQueue: Array<{ data: unknown; error: unknown }> = []
let grantsResponseQueue: Array<{ data: unknown; error: unknown }> = []

// Pull-based thenable: each `await chain.<terminal>()` consumes the
// next queued response. The two queues are swapped per-call using
// the per-chain `pull` closure so reviews reads don't accidentally
// consume grants reads.
type ResponseQueue = Array<{ data: unknown; error: unknown }>
function makeChain(pull: () => { data: unknown; error: unknown }) {
  // Mirror the Supabase JS client where any chain (not just terminal
  // methods like `single`/`maybeSingle`) is itself thenable. Our
  // real Supabase usage calls `await supabase.from(...).select(...)`
  // without a terminal — the returned value is `{ data, error }`.
  const awaitable: { data: unknown; error: unknown } = { data: null, error: null }
  const chain: any = {
    select(payload: string) {
      calls.push({ method: 'select', payload })
      return chain
    },
    eq(col: string, val: unknown) {
      calls.push({ method: 'eq', col, val })
      return chain
    },
    is(col: string, val: unknown) {
      calls.push({ method: 'is', col, val })
      return chain
    },
    order(col: string, opts: { ascending?: boolean } = {}) {
      calls.push({ method: 'order', col, ascending: opts.ascending ?? true })
      return chain
    },
    // thenable — `await chain` resolves to the queued response.
    then(resolve: (v: unknown) => void) {
      const next = pull()
      resolve(next)
      awaitable.data = next.data
      awaitable.error = next.error
    },
  }
  // Backing field for tests that want to inspect the awaited result
  // via the resolved `awaitable` directly (defensive — unused so far).
  ;(chain as { __awaitable: unknown }).__awaitable = awaitable
  return chain
}

// `from('reviews')` reads the reviews queue; everything else reads
// the grants queue. `vi.fn(() => makeChain(...))` lets each test
// assert which tables were hit.
const fakeSupabase = {
  from: vi.fn((table: string) => {
    if (table === 'reviews') {
      return makeChain(() => reviewsResponseQueue.shift() ?? { data: null, error: null })
    }
    // 'library_grants' is the only other table these queries hit.
    return makeChain(() => grantsResponseQueue.shift() ?? { data: null, error: null })
  }),
  auth: {
    getUser: vi.fn(async () => ({ data: { user: mockUser }, error: null })),
  },
}

vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: vi.fn(async () => fakeSupabase),
}))

const { getMyReviews, getReviewableProducts } = await import('./getMyReviews')

beforeEach(() => {
  calls.length = 0
  reviewsResponseQueue = []
  grantsResponseQueue = []
  mockUser = { id: 'user-uuid-1', email: 'klaas@example.com' }
  fakeSupabase.from.mockClear()
  fakeSupabase.auth.getUser.mockClear()
  fakeSupabase.auth.getUser.mockImplementation(async () => ({
    data: { user: mockUser },
    error: null,
  }))
})

afterEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// getMyReviews — auth gating
// ---------------------------------------------------------------------------

describe('getMyReviews — auth gating', () => {
  it('returns [] for an anonymous caller without touching the DB', async () => {
    mockUser = null
    const result = await getMyReviews()
    expect(result).toEqual([])
    expect(fakeSupabase.from).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// getMyReviews — happy path + defensive mapping
// ---------------------------------------------------------------------------

describe('getMyReviews — happy path', () => {
  it('maps every field for both the review row and the joined product', async () => {
    reviewsResponseQueue = [
      {
        data: [
          {
            id: 42,
            product_id: 7,
            rating: 5,
            title: 'Loved it',
            body: 'Sixty-plus chars of body content for review form mapping verification.',
            status: 'published',
            created_at: '2026-06-01T10:00:00Z',
            updated_at: '2026-06-01T10:00:00Z',
            products: { title: 'Affiliate 101', slug: 'affiliate-101' },
          },
        ],
        error: null,
      },
    ]
    const result = await getMyReviews()
    expect(result).toEqual([
      {
        id: 42,
        product_id: 7,
        product_title: 'Affiliate 101',
        product_slug: 'affiliate-101',
        rating: 5,
        title: 'Loved it',
        body: 'Sixty-plus chars of body content for review form mapping verification.',
        status: 'published',
        created_at: '2026-06-01T10:00:00Z',
        updated_at: '2026-06-01T10:00:00Z',
      },
    ])
  })

  it('maps a null title to null (not an empty string)', async () => {
    reviewsResponseQueue = [
      {
        data: [
          {
            id: 1,
            product_id: 2,
            rating: 4,
            title: null,
            body: 'Body text without a title — make sure it stays null in the mapped shape.',
            status: 'pending',
            created_at: '2026-06-15T00:00:00Z',
            updated_at: '2026-06-15T00:00:00Z',
            products: { title: 'Course', slug: 'course' },
          },
        ],
        error: null,
      },
    ]
    const result = await getMyReviews()
    expect(result[0]?.title).toBeNull()
  })
})

describe('getMyReviews — defensive mapping', () => {
  it('falls back to "(removed product)" + null slug when the joined product is missing (RLS removes the products row)', async () => {
    reviewsResponseQueue = [
      {
        data: [
          {
            id: 1,
            product_id: 9999,
            rating: 3,
            title: null,
            body: 'Body still renders even when the product join returns null because the row was archived.',
            status: 'pending',
            created_at: '2026-06-15T00:00:00Z',
            updated_at: '2026-06-15T00:00:00Z',
            // products join returns null (e.g. RLS hid the row, or the product was archived)
            products: null,
          },
        ],
        error: null,
      },
    ]
    const result = await getMyReviews()
    expect(result[0]?.product_title).toBe('(removed product)')
    expect(result[0]?.product_slug).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// getMyReviews — error & empty paths
// ---------------------------------------------------------------------------

describe('getMyReviews — error & empty paths', () => {
  it('returns [] on DB error (fail-soft)', async () => {
    reviewsResponseQueue = [{ data: null, error: { message: 'connection refused' } }]
    const result = await getMyReviews()
    expect(result).toEqual([])
  })

  it('returns [] when the query returns an empty array', async () => {
    reviewsResponseQueue = [{ data: [], error: null }]
    const result = await getMyReviews()
    expect(result).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// getMyReviews — query shape (defense in depth)
// ---------------------------------------------------------------------------

describe('getMyReviews — query shape', () => {
  it('selects only the review fields + the products(title, slug) join (no PII columns)', async () => {
    reviewsResponseQueue = [{ data: [], error: null }]
    await getMyReviews()
    const selectCall = calls.find((c) => c.method === 'select')
    expect(selectCall).toBeDefined()
    if (selectCall?.method === 'select') {
      expect(selectCall.payload).toBe(
        'id, product_id, rating, title, body, status, created_at, updated_at, products(title, slug)',
      )
      // PII safety — never select these columns.
      expect(selectCall.payload).not.toContain('email')
      expect(selectCall.payload).not.toContain('ip')
      expect(selectCall.payload).not.toContain('user_agent')
      expect(selectCall.payload).not.toContain('password')
      expect(selectCall.payload).not.toContain('token')
    }
  })

  it('filters the read by user_id (self-read RLS contract)', async () => {
    reviewsResponseQueue = [{ data: [], error: null }]
    await getMyReviews()
    const eqUserId = calls.find((c) => c.method === 'eq' && c.col === 'user_id')
    expect(eqUserId).toBeDefined()
    if (eqUserId?.method === 'eq') {
      expect(eqUserId.val).toBe('user-uuid-1')
    }
  })

  it('sorts by created_at desc so the newest review is at the top', async () => {
    reviewsResponseQueue = [{ data: [], error: null }]
    await getMyReviews()
    const orderCall = calls.find(
      (c) => c.method === 'order' && c.col === 'created_at',
    )
    expect(orderCall).toBeDefined()
    if (orderCall?.method === 'order') {
      expect(orderCall.ascending).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// getReviewableProducts — auth gating
// ---------------------------------------------------------------------------

describe('getReviewableProducts — auth gating', () => {
  it('returns [] for an anonymous caller without touching the DB', async () => {
    mockUser = null
    const result = await getReviewableProducts()
    expect(result).toEqual([])
    expect(fakeSupabase.from).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// getReviewableProducts — happy path + the "already reviewed" filter
// ---------------------------------------------------------------------------

describe('getReviewableProducts — happy path', () => {
  it('returns the grant as a reviewable product with partner_name + license + granted_at', async () => {
    // First call: library_grants query → one grant
    grantsResponseQueue = [
      {
        data: [
          {
            product_id: 7,
            source: 'purchase',
            license: 'PLR',
            created_at: '2026-06-01T10:00:00Z',
            products: {
              title: 'Affiliate 101',
              slug: 'affiliate-101',
              partners: { display_name: 'Pat Partner' },
            },
          },
        ],
        error: null,
      },
    ]
    // Second call: reviews query → no reviews for this user
    reviewsResponseQueue = [{ data: [], error: null }]
    const result = await getReviewableProducts()
    expect(result).toEqual([
      {
        product_id: 7,
        product_title: 'Affiliate 101',
        product_slug: 'affiliate-101',
        partner_name: 'Pat Partner',
        grant_source: 'purchase',
        granted_at: '2026-06-01T10:00:00Z',
        license: 'PLR',
      },
    ])
  })

  it('excludes products the user has already reviewed (reviewable list excludes reviewed products)', async () => {
    // Two grants, one of which has an existing review.
    grantsResponseQueue = [
      {
        data: [
          {
            product_id: 7,
            source: 'purchase',
            license: 'PLR',
            created_at: '2026-06-01T10:00:00Z',
            products: {
              title: 'Affiliate 101',
              slug: 'affiliate-101',
              partners: { display_name: 'Pat Partner' },
            },
          },
          {
            product_id: 8,
            source: 'admin_grant',
            license: 'MRR',
            created_at: '2026-05-15T00:00:00Z',
            products: {
              title: 'Course Eight',
              slug: 'course-eight',
              partners: { display_name: 'Other Partner' },
            },
          },
        ],
        error: null,
      },
    ]
    // User has already reviewed product_id 7 (the spec says "any status,
    // including deleted" — so even a `hidden` (soft-deleted) review
    // excludes the product from the reviewable list).
    reviewsResponseQueue = [{ data: [{ product_id: 7 }], error: null }]
    const result = await getReviewableProducts()
    expect(result).toEqual([
      {
        product_id: 8,
        product_title: 'Course Eight',
        product_slug: 'course-eight',
        partner_name: 'Other Partner',
        grant_source: 'admin_grant',
        granted_at: '2026-05-15T00:00:00Z',
        license: 'MRR',
      },
    ])
  })
})

// ---------------------------------------------------------------------------
// getReviewableProducts — defensive mapping
// ---------------------------------------------------------------------------

describe('getReviewableProducts — defensive mapping', () => {
  it('falls back to "(removed product)" + null slug when the product join is missing', async () => {
    grantsResponseQueue = [
      {
        data: [
          {
            product_id: 1234,
            source: 'subscription',
            license: null,
            created_at: '2026-06-01T10:00:00Z',
            products: null,
          },
        ],
        error: null,
      },
    ]
    reviewsResponseQueue = [{ data: [], error: null }]
    const result = await getReviewableProducts()
    expect(result[0]?.product_title).toBe('(removed product)')
    expect(result[0]?.product_slug).toBeNull()
    expect(result[0]?.partner_name).toBeNull() // partner is on the products join
  })

  it('returns null partner_name when the product has no partner (joined `partners` is null)', async () => {
    grantsResponseQueue = [
      {
        data: [
          {
            product_id: 42,
            source: 'purchase',
            license: 'PLR',
            created_at: '2026-06-01T10:00:00Z',
            products: {
              title: 'Solo Course',
              slug: 'solo-course',
              partners: null, // no partner assigned
            },
          },
        ],
        error: null,
      },
    ]
    reviewsResponseQueue = [{ data: [], error: null }]
    const result = await getReviewableProducts()
    expect(result[0]?.partner_name).toBeNull()
    expect(result[0]?.product_title).toBe('Solo Course')
  })

  it('returns null license when the grant has no license (defensive — the column is nullable)', async () => {
    grantsResponseQueue = [
      {
        data: [
          {
            product_id: 11,
            source: 'free_promo',
            license: null,
            created_at: '2026-06-01T10:00:00Z',
            products: {
              title: 'Promo',
              slug: 'promo',
              partners: { display_name: 'Promo Partner' },
            },
          },
        ],
        error: null,
      },
    ]
    reviewsResponseQueue = [{ data: [], error: null }]
    const result = await getReviewableProducts()
    expect(result[0]?.license).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// getReviewableProducts — error & empty paths
// ---------------------------------------------------------------------------

describe('getReviewableProducts — error & empty paths', () => {
  it('returns [] on grants DB error (fail-soft)', async () => {
    grantsResponseQueue = [{ data: null, error: { message: 'connection refused' } }]
    reviewsResponseQueue = [{ data: [], error: null }]
    const result = await getReviewableProducts()
    expect(result).toEqual([])
  })

  it('returns [] when the grants query returns null', async () => {
    grantsResponseQueue = [{ data: null, error: null }]
    reviewsResponseQueue = [{ data: [], error: null }]
    const result = await getReviewableProducts()
    expect(result).toEqual([])
  })

  it('returns [] when the grants query returns an empty array (no grants → no reviewable products)', async () => {
    grantsResponseQueue = [{ data: [], error: null }]
    // No need to hit the reviews query if there are zero grants — but the
    // current implementation always does; queue an empty response either way.
    reviewsResponseQueue = [{ data: [], error: null }]
    const result = await getReviewableProducts()
    expect(result).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// getReviewableProducts — query shape
// ---------------------------------------------------------------------------

describe('getReviewableProducts — query shape', () => {
  it('selects grant fields + the products(title, slug, partners(display_name)) nested join (no PII columns)', async () => {
    grantsResponseQueue = [{ data: [], error: null }]
    reviewsResponseQueue = [{ data: [], error: null }]
    await getReviewableProducts()
    const selectCall = calls.find((c) => c.method === 'select')
    expect(selectCall).toBeDefined()
    if (selectCall?.method === 'select') {
      expect(selectCall.payload).toBe(
        'product_id, source, license, created_at, products(title, slug, partners!products_partner_id_fkey(display_name))',
      )
      expect(selectCall.payload).not.toContain('email')
      expect(selectCall.payload).not.toContain('user_agent')
      expect(selectCall.payload).not.toContain('token')
    }
  })

  it('filters the grants query by user_id + revoked_at IS NULL + orders by created_at desc', async () => {
    grantsResponseQueue = [{ data: [], error: null }]
    reviewsResponseQueue = [{ data: [], error: null }]
    await getReviewableProducts()
    // The chain is shared across both queries; we only assert on the
    // grants portion. Take calls up to the first `.order` on
    // `created_at`.
    expect(fakeSupabase.from).toHaveBeenCalledWith('library_grants')
    expect(fakeSupabase.from).toHaveBeenCalledWith('reviews')

    // All `eq` calls belong to the grants query (the reviews query
    // doesn't filter by anything — it selects all rows by the implicit
    // auth.uid() RLS scope).
    const eqUserId = calls.find((c) => c.method === 'eq' && c.col === 'user_id')
    expect(eqUserId).toBeDefined()
    if (eqUserId?.method === 'eq') {
      expect(eqUserId.val).toBe('user-uuid-1')
    }

    const isRevoked = calls.find((c) => c.method === 'is' && c.col === 'revoked_at')
    expect(isRevoked).toBeDefined()
    if (isRevoked?.method === 'is') {
      expect(isRevoked.val).toBeNull()
    }

    const orderCall = calls.find(
      (c) => c.method === 'order' && c.col === 'created_at',
    )
    expect(orderCall).toBeDefined()
    if (orderCall?.method === 'order') {
      expect(orderCall.ascending).toBe(false)
    }
  })
})
