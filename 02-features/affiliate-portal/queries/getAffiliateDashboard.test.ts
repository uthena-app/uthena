// getAffiliateDashboard.test.ts — P13.3 dashboard query tests.
//
// Coverage:
//   - Null returns when there's no auth user
//   - Null returns when the affiliates row is missing
//   - Null returns when the affiliates row read errors
//   - Happy path: full aggregator returns all 4 fields, correctly
//     coerced (bigint-as-string → number)
//   - Fail-soft: profile error doesn't kill the result (header
//     falls back to email-only)
//   - Defensive narrowing: bad input on every field falls back to a
//     safe default (never throws)
//   - PII safety: no raw affiliate_id / email / user_id in log calls
//
// All Supabase calls are mocked — this is a pure unit test of the
// narrowing + orchestration logic, not the SQL.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- mock supabase chainable builder ---------------------------------------

function makeChain(initial: {
  data: unknown
  error: unknown
} = { data: null, error: null }) {
  const state: { data: unknown; error: unknown } = { ...initial }
  const builder: Record<string, unknown> = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn(() => Promise.resolve({ data: state.data, error: state.error })),
  }
  return { builder, state }
}

function makeRpcChain(payload: unknown) {
  return Promise.resolve({ data: payload, error: null })
}

// --- mock the supabase + logger modules -----------------------------------

const mockGetServerSupabase = vi.fn()
const mockWarn = vi.fn()

vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: () => mockGetServerSupabase(),
}))

vi.mock('@foundations/log/pino', () => ({
  loggerFor: () => ({ warn: mockWarn }),
}))

/** Build a fake supabase client keyed off per-table `from` handlers
 *  and per-name `rpc` handlers. `user` may be null (anon) or a
 *  populated object (authed). The user object returned matches the
 *  shape of Supabase's `supabase.auth.getUser()` resolves to:
 *  `{ data: { user }, error }`. */
function makeFakeSupabase(args: {
  user: { id: string } | null
  fromHandlers: Record<string, () => unknown>
  rpcHandlers: Record<string, () => Promise<unknown>>
}) {
  return {
    auth: {
      getUser: () =>
        Promise.resolve({
          data: { user: args.user },
          error: null,
        }),
    },
    from: (table: string) => args.fromHandlers[table]!(),
    rpc: (fn: string) => args.rpcHandlers[fn]!(),
  }
}

beforeEach(() => {
  vi.resetModules()
  mockGetServerSupabase.mockReset()
  mockWarn.mockReset()
})

// Re-import the module under test AFTER resetting mocks so its
// module-scope loggerFor is initialized with the current mock.
async function loadQuery() {
  return await import('./getAffiliateDashboard')
}

// --- tests ------------------------------------------------------------------

describe('getAffiliateDashboard — auth gating', () => {
  it('returns null when there is no auth user', async () => {
    mockGetServerSupabase.mockResolvedValue(
      makeFakeSupabase({
        user: null,
        fromHandlers: {},
        rpcHandlers: {},
      }),
    )
    const q = await loadQuery()
    const out = await q.getAffiliateDashboard()
    expect(out).toBeNull()
  })
})

describe('getAffiliateDashboard — affiliates row missing / errors', () => {
  it('returns null when the affiliates row is missing', async () => {
    const aff = makeChain({ data: null, error: null })
    mockGetServerSupabase.mockResolvedValue(
      makeFakeSupabase({
        user: { id: 'user-1' },
        fromHandlers: { affiliates: () => aff.builder },
        rpcHandlers: {},
      }),
    )
    const q = await loadQuery()
    const out = await q.getAffiliateDashboard()
    expect(out).toBeNull()
    expect(mockWarn).not.toHaveBeenCalled()
  })

  it('returns null when the affiliates row read errors', async () => {
    const aff = makeChain({ data: null, error: { code: 'PGRST116', message: 'oops' } })
    mockGetServerSupabase.mockResolvedValue(
      makeFakeSupabase({
        user: { id: 'user-1' },
        fromHandlers: { affiliates: () => aff.builder },
        rpcHandlers: {},
      }),
    )
    const q = await loadQuery()
    const out = await q.getAffiliateDashboard()
    expect(out).toBeNull()
    expect(mockWarn).toHaveBeenCalledTimes(1)
  })

  it('returns null when the affiliates row id is missing', async () => {
    const aff = makeChain({
      data: { handle: 'alice', status: 'approved', approved_at: null },
      error: null,
    })
    mockGetServerSupabase.mockResolvedValue(
      makeFakeSupabase({
        user: { id: 'user-1' },
        fromHandlers: { affiliates: () => aff.builder },
        rpcHandlers: {},
      }),
    )
    const q = await loadQuery()
    const out = await q.getAffiliateDashboard()
    // id=0 → narrowAffiliateRow returns null (falsy id)
    expect(out).toBeNull()
  })
})

describe('getAffiliateDashboard — happy path', () => {
  it('returns the full aggregator shape on a complete affiliates row + profile + RPCs', async () => {
    const aff = makeChain({
      data: {
        id: 42,
        handle: 'alice',
        status: 'approved',
        approved_at: '2026-05-01T00:00:00.000Z',
        payout_method: { paypal_email: 'k***@example.com' },
      },
      error: null,
    })
    const profile = makeChain({
      data: { display_name: 'Alice', email: 'alice@example.com' },
      error: null,
    })

    mockGetServerSupabase.mockResolvedValue(
      makeFakeSupabase({
        user: { id: 'user-1' },
        fromHandlers: {
          affiliates: () => aff.builder,
          profiles: () => profile.builder,
        },
        rpcHandlers: {
          ensure_default_affiliate_link: () =>
            makeRpcChain({
              id: 99,
              code: 'alice',
              destination_path: '/',
              affiliate_id: 42,
            }),
          get_affiliate_summary: () =>
            makeRpcChain([
              {
                lifetime_earned_cents: '1500000',
                month_earned_cents: '250000',
                clicks_30d_count: '143',
                conversions_30d_count: '7',
                payout_method_present: true,
              },
            ]),
        },
      }),
    )

    const q = await loadQuery()
    const out = await q.getAffiliateDashboard()
    expect(out).not.toBeNull()
    expect(out!.affiliate).toEqual({
      id: 42,
      handle: 'alice',
      status: 'approved',
      approvedAt: '2026-05-01T00:00:00.000Z',
      payoutMethodPresent: true,
    })
    expect(out!.profile).toEqual({
      displayName: 'Alice',
      email: 'alice@example.com',
    })
    expect(out!.defaultLink).toEqual({
      id: 99,
      code: 'alice',
      destinationPath: '/',
      affiliateId: 42,
    })
    expect(out!.summary).toEqual({
      lifetimeEarnedCents: 1500000,
      monthEarnedCents: 250000,
      clicks30d: 143,
      conversions30d: 7,
    })
  })

  it('handles a non-approved (pending) affiliate + null approved_at + payout_method absent', async () => {
    const aff = makeChain({
      data: {
        id: 7,
        handle: 'bob',
        status: 'pending',
        approved_at: null,
        payout_method: null,
      },
      error: null,
    })
    const profile = makeChain({
      data: { display_name: 'Bob', email: 'bob@example.com' },
      error: null,
    })

    mockGetServerSupabase.mockResolvedValue(
      makeFakeSupabase({
        user: { id: 'user-2' },
        fromHandlers: {
          affiliates: () => aff.builder,
          profiles: () => profile.builder,
        },
        rpcHandlers: {
          ensure_default_affiliate_link: () => makeRpcChain({ id: 1, code: 'bob', destination_path: '/', affiliate_id: 7 }),
          get_affiliate_summary: () =>
            makeRpcChain([
              {
                lifetime_earned_cents: 0,
                month_earned_cents: 0,
                clicks_30d_count: 0,
                conversions_30d_count: 0,
                payout_method_present: false,
              },
            ]),
        },
      }),
    )

    const q = await loadQuery()
    const out = await q.getAffiliateDashboard()
    expect(out!.affiliate.status).toBe('pending')
    expect(out!.affiliate.approvedAt).toBeNull()
    expect(out!.affiliate.payoutMethodPresent).toBe(false)
    expect(out!.summary.lifetimeEarnedCents).toBe(0)
  })

  it('coerces numeric KPI strings + handles null fields', async () => {
    const aff = makeChain({
      data: { id: 42, handle: 'alice', status: 'approved', approved_at: null, payout_method: null },
      error: null,
    })
    const profile = makeChain({ data: null, error: null })

    mockGetServerSupabase.mockResolvedValue(
      makeFakeSupabase({
        user: { id: 'user-1' },
        fromHandlers: {
          affiliates: () => aff.builder,
          profiles: () => profile.builder,
        },
        rpcHandlers: {
          ensure_default_affiliate_link: () =>
            makeRpcChain({ id: 99, code: 'alice', destination_path: '/', affiliate_id: 42 }),
          // String-encoded bigints (the realistic postgREST shape for bigint cols)
          get_affiliate_summary: () =>
            makeRpcChain([
              {
                lifetime_earned_cents: '1500000',
                month_earned_cents: '0',
                clicks_30d_count: '3',
                conversions_30d_count: null,
                payout_method_present: null,
              },
            ]),
        },
      }),
    )

    const q = await loadQuery()
    const out = await q.getAffiliateDashboard()
    expect(out!.summary.lifetimeEarnedCents).toBe(1500000)
    expect(out!.summary.monthEarnedCents).toBe(0)
    expect(out!.summary.clicks30d).toBe(3)
    expect(out!.summary.conversions30d).toBe(0) // null → 0
  })
})

describe('getAffiliateDashboard — fail-soft paths', () => {
  it('returns the result with empty profile when the profile read errors', async () => {
    const aff = makeChain({
      data: { id: 42, handle: 'alice', status: 'approved', approved_at: null, payout_method: null },
      error: null,
    })
    // profiles read errors
    const profile = makeChain({ data: null, error: { code: 'PGRST500', message: 'oops' } })
    mockGetServerSupabase.mockResolvedValue(
      makeFakeSupabase({
        user: { id: 'user-1' },
        fromHandlers: {
          affiliates: () => aff.builder,
          profiles: () => profile.builder,
        },
        rpcHandlers: {
          ensure_default_affiliate_link: () =>
            makeRpcChain({ id: 99, code: 'alice', destination_path: '/', affiliate_id: 42 }),
          get_affiliate_summary: () =>
            makeRpcChain([
              {
                lifetime_earned_cents: '0',
                month_earned_cents: '0',
                clicks_30d_count: '0',
                conversions_30d_count: '0',
                payout_method_present: false,
              },
            ]),
        },
      }),
    )

    const q = await loadQuery()
    const out = await q.getAffiliateDashboard()
    expect(out).not.toBeNull()
    expect(out!.profile).toEqual({ displayName: '', email: '' })
    expect(mockWarn).toHaveBeenCalledTimes(1)
  })

  it('handles a NULL default-link RPC result', async () => {
    const aff = makeChain({
      data: { id: 42, handle: 'alice', status: 'approved', approved_at: null, payout_method: null },
      error: null,
    })
    const profile = makeChain({ data: { display_name: 'Alice', email: 'alice@example.com' }, error: null })
    mockGetServerSupabase.mockResolvedValue(
      makeFakeSupabase({
        user: { id: 'user-1' },
        fromHandlers: {
          affiliates: () => aff.builder,
          profiles: () => profile.builder,
        },
        rpcHandlers: {
          ensure_default_affiliate_link: () => Promise.resolve({ data: null, error: null }),
          get_affiliate_summary: () =>
            makeRpcChain([
              {
                lifetime_earned_cents: '0',
                month_earned_cents: '0',
                clicks_30d_count: '0',
                conversions_30d_count: '0',
                payout_method_present: false,
              },
            ]),
        },
      }),
    )

    const q = await loadQuery()
    const out = await q.getAffiliateDashboard()
    expect(out!.defaultLink).toBeNull()
  })

  it('handles a malformed default-link RPC result (missing fields) by returning null', async () => {
    const aff = makeChain({
      data: { id: 42, handle: 'alice', status: 'approved', approved_at: null, payout_method: null },
      error: null,
    })
    const profile = makeChain({ data: { display_name: 'Alice', email: 'alice@example.com' }, error: null })
    mockGetServerSupabase.mockResolvedValue(
      makeFakeSupabase({
        user: { id: 'user-1' },
        fromHandlers: {
          affiliates: () => aff.builder,
          profiles: () => profile.builder,
        },
        rpcHandlers: {
          ensure_default_affiliate_link: () => makeRpcChain({ id: null, code: '' }),
          get_affiliate_summary: () =>
            makeRpcChain([
              {
                lifetime_earned_cents: '0',
                month_earned_cents: '0',
                clicks_30d_count: '0',
                conversions_30d_count: '0',
                payout_method_present: false,
              },
            ]),
        },
      }),
    )

    const q = await loadQuery()
    const out = await q.getAffiliateDashboard()
    expect(out!.defaultLink).toBeNull()
  })

  it('returns zero KPIs when the summary RPC returns an empty array', async () => {
    const aff = makeChain({
      data: { id: 42, handle: 'alice', status: 'approved', approved_at: null, payout_method: null },
      error: null,
    })
    const profile = makeChain({ data: { display_name: 'Alice', email: 'alice@example.com' }, error: null })
    mockGetServerSupabase.mockResolvedValue(
      makeFakeSupabase({
        user: { id: 'user-1' },
        fromHandlers: {
          affiliates: () => aff.builder,
          profiles: () => profile.builder,
        },
        rpcHandlers: {
          ensure_default_affiliate_link: () =>
            makeRpcChain({ id: 99, code: 'alice', destination_path: '/', affiliate_id: 42 }),
          get_affiliate_summary: () => makeRpcChain([]),
        },
      }),
    )

    const q = await loadQuery()
    const out = await q.getAffiliateDashboard()
    expect(out!.summary).toEqual({
      lifetimeEarnedCents: 0,
      monthEarnedCents: 0,
      clicks30d: 0,
      conversions30d: 0,
    })
  })
})

describe('getAffiliateDashboard — PII safety in logs', () => {
  it('logs only the FNV-1a-hashed affiliate_id, never the raw id or email', async () => {
    const aff = makeChain({
      data: { id: 999, handle: 'alice', status: 'approved', approved_at: null, payout_method: null },
      error: null,
    })
    const profile = makeChain({ data: null, error: { code: 'PGRST500', message: 'oops' } })
    mockGetServerSupabase.mockResolvedValue(
      makeFakeSupabase({
        user: { id: 'user-1' },
        fromHandlers: {
          affiliates: () => aff.builder,
          profiles: () => profile.builder,
        },
        rpcHandlers: {
          ensure_default_affiliate_link: () =>
            makeRpcChain({ id: 99, code: 'alice', destination_path: '/', affiliate_id: 999 }),
          get_affiliate_summary: () =>
            makeRpcChain([
              {
                lifetime_earned_cents: '0',
                month_earned_cents: '0',
                clicks_30d_count: '0',
                conversions_30d_count: '0',
                payout_method_present: false,
              },
            ]),
        },
      }),
    )

    const q = await loadQuery()
    await q.getAffiliateDashboard()

    // Profile read fails → warn is called. The payload must contain
    // the hashed affiliate_id and NEVER the raw 999 / 'alice' / email.
    expect(mockWarn).toHaveBeenCalledTimes(1)
    const [payload] = mockWarn.mock.calls[0] as [Record<string, unknown>, string]
    expect(payload.affiliate_id_hash).toBeTypeOf('string')
    expect(payload.affiliate_id_hash).toMatch(/^[0-9a-f]{8}$/)
    // raw 999, 'alice', email patterns must not appear anywhere in
    // the payload.
    const allValues = Object.values(payload).map(String).join(' ')
    expect(allValues).not.toContain('999')
    expect(allValues).not.toContain('alice@example.com')
  })

  it('does not log on the happy path (no warn calls)', async () => {
    const aff = makeChain({
      data: { id: 42, handle: 'alice', status: 'approved', approved_at: null, payout_method: null },
      error: null,
    })
    const profile = makeChain({ data: { display_name: 'Alice', email: 'alice@example.com' }, error: null })
    mockGetServerSupabase.mockResolvedValue(
      makeFakeSupabase({
        user: { id: 'user-1' },
        fromHandlers: {
          affiliates: () => aff.builder,
          profiles: () => profile.builder,
        },
        rpcHandlers: {
          ensure_default_affiliate_link: () =>
            makeRpcChain({ id: 99, code: 'alice', destination_path: '/', affiliate_id: 42 }),
          get_affiliate_summary: () =>
            makeRpcChain([
              {
                lifetime_earned_cents: '0',
                month_earned_cents: '0',
                clicks_30d_count: '0',
                conversions_30d_count: '0',
                payout_method_present: false,
              },
            ]),
        },
      }),
    )

    const q = await loadQuery()
    await q.getAffiliateDashboard()
    // No warn on the happy path → no log payload at all → nothing to
    // assert beyond the call count. (Belt-and-suspenders against a
    // future "log everything" refactor.)
    expect(mockWarn).not.toHaveBeenCalled()
  })
})
