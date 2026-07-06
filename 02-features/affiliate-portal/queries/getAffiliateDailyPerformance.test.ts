// getAffiliateDailyPerformance.test.ts — P13.4 daily performance query.
//
// Coverage mirrors getAffiliateDashboard.test.ts:
//   - Anon path (no auth user) returns []
//   - Non-affiliate path (no `affiliates` row) returns [] without
//     calling the RPC
//   - RPC error returns [] + warn with FNV-1a-hashed affiliate_id
//     (NEVER raw affiliate_id in the log payload)
//   - Happy path: all 3 series mapped correctly with bigint-as-string
//     defensive coercion
//   - Null / malformed fields fall back to 0 (defensive narrowing)
//   - Non-array RPC response falls back to []
//   - daysBack parameter forwarding (default 30 + custom 14 / 90)
//   - Coerced day string tolerates ISO-prefix variants
//
// All Supabase calls are mocked — this is a pure unit test of the
// JS orchestration + narrowing, not the SQL.

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

/** Build a chainable Supabase `from(...).select(...).eq(...).maybeSingle()`
 *  builder. Returns `{data, error}` from `maybeSingle()`. */
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

/** Build a `supabase.rpc(name, args)` handler that resolves to the
 *  given payload. */
function rpcHandler(payload: unknown) {
  return () => Promise.resolve({ data: payload, error: null })
}

/** Build a fake supabase client matching the shape used by the query.
 *  `user` may be null (anon). `fromHandlers` map tables to chainable
 *  builders. `rpcHandlers` map RPC names to resolved payloads. */
function makeFakeSupabase(args: {
  user: { id: string } | null
  fromHandlers: Record<string, () => unknown>
  rpcHandlers: Record<string, () => Promise<unknown>>
}) {
  return {
    auth: {
      getUser: () =>
        Promise.resolve({ data: { user: args.user }, error: null }),
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

/** Reload the query module AFTER resetting mocks so its module-scope
 *  loggerFor is initialized with the current mock. */
async function loadQuery() {
  return await import('./getAffiliateDailyPerformance')
}

// --- tests ------------------------------------------------------------------

describe('getAffiliateDailyPerformance — auth + ownership gates', () => {
  it('returns [] when there is no auth user', async () => {
    mockGetServerSupabase.mockResolvedValue(
      makeFakeSupabase({
        user: null,
        fromHandlers: {},
        rpcHandlers: {},
      }),
    )
    const q = await loadQuery()
    const out = await q.getAffiliateDailyPerformance()
    expect(out).toEqual([])
  })

  it('returns [] when the affiliates row is missing (non-affiliate user)', async () => {
    const aff = makeChain({ data: null, error: null })
    mockGetServerSupabase.mockResolvedValue(
      makeFakeSupabase({
        user: { id: 'user-1' },
        fromHandlers: { affiliates: () => aff.builder },
        rpcHandlers: {},
      }),
    )
    const q = await loadQuery()
    const out = await q.getAffiliateDailyPerformance()
    expect(out).toEqual([])
    // No RPC should fire — the affiliates-row check is the gate.
    expect(mockWarn).not.toHaveBeenCalled()
  })
})

describe('getAffiliateDailyPerformance — happy path', () => {
  it('returns the full N-row series with all 3 series coerced', async () => {
    const aff = makeChain({ data: { id: 42 }, error: null })
    const rpcPayload = [
      { day: '2026-06-01', clicks_count: '120', conversions_count: '3', revenue_cents: '4500' },
      { day: '2026-06-02', clicks_count: '95',  conversions_count: '1', revenue_cents: '1500' },
      { day: '2026-06-03', clicks_count: '0',   conversions_count: '0', revenue_cents: '0' },
      { day: '2026-06-04', clicks_count: '210', conversions_count: '8', revenue_cents: '12000' },
    ]
    mockGetServerSupabase.mockResolvedValue(
      makeFakeSupabase({
        user: { id: 'user-1' },
        fromHandlers: { affiliates: () => aff.builder },
        rpcHandlers: {
          get_affiliate_daily_performance: rpcHandler(rpcPayload),
        },
      }),
    )
    const q = await loadQuery()
    const out = await q.getAffiliateDailyPerformance({ daysBack: 4 })
    expect(out).toEqual([
      { day: '2026-06-01', clicksCount: 120, conversionsCount: 3, revenueCents: 4500 },
      { day: '2026-06-02', clicksCount: 95,  conversionsCount: 1, revenueCents: 1500 },
      { day: '2026-06-03', clicksCount: 0,   conversionsCount: 0, revenueCents: 0 },
      { day: '2026-06-04', clicksCount: 210, conversionsCount: 8, revenueCents: 12000 },
    ])
  })

  it('defaults daysBack to 30 when not provided', async () => {
    const aff = makeChain({ data: { id: 42 }, error: null })
    const rpcCalls: Array<Record<string, unknown>> = []
    const handler = (
      _name: string,
      args: Record<string, unknown>,
    ) => {
      rpcCalls.push(args)
      return Promise.resolve({ data: [], error: null })
    }
    mockGetServerSupabase.mockResolvedValue({
      auth: {
        getUser: () => Promise.resolve({ data: { user: { id: 'u' } }, error: null }),
      },
      from: (table: string) => {
        if (table === 'affiliates') return aff.builder
        throw new Error(`unexpected from: ${table}`)
      },
      rpc: (fn: string, args: Record<string, unknown>) => handler(fn, args),
    })
    const q = await loadQuery()
    await q.getAffiliateDailyPerformance()
    expect(rpcCalls.length).toBe(1)
    expect(rpcCalls[0]!.p_days_back).toBe(30)
    expect(rpcCalls[0]!.p_affiliate_id).toBe(42)
  })

  it('forwards a custom daysBack value to the RPC', async () => {
    const aff = makeChain({ data: { id: 42 }, error: null })
    const rpcCalls: Array<Record<string, unknown>> = []
    mockGetServerSupabase.mockResolvedValue({
      auth: {
        getUser: () => Promise.resolve({ data: { user: { id: 'u' } }, error: null }),
      },
      from: (table: string) => {
        if (table === 'affiliates') return aff.builder
        throw new Error(`unexpected from: ${table}`)
      },
      rpc: (_fn: string, args: Record<string, unknown>) => {
        rpcCalls.push(args)
        return Promise.resolve({ data: [], error: null })
      },
    })
    const q = await loadQuery()
    await q.getAffiliateDailyPerformance({ daysBack: 90 })
    expect(rpcCalls[0]!.p_days_back).toBe(90)
  })

  it('coerces ISO-prefix date variants (full ISO → YYYY-MM-DD)', async () => {
    const aff = makeChain({ data: { id: 42 }, error: null })
    const rpcPayload = [
      { day: '2026-06-01T00:00:00+00:00', clicks_count: '5', conversions_count: '1', revenue_cents: '1500' },
      { day: '2026-06-02T00:00:00.000Z', clicks_count: '0', conversions_count: '0', revenue_cents: '0' },
    ]
    mockGetServerSupabase.mockResolvedValue(
      makeFakeSupabase({
        user: { id: 'u' },
        fromHandlers: { affiliates: () => aff.builder },
        rpcHandlers: {
          get_affiliate_daily_performance: rpcHandler(rpcPayload),
        },
      }),
    )
    const q = await loadQuery()
    const out = await q.getAffiliateDailyPerformance({ daysBack: 7 })
    expect(out[0]!.day).toBe('2026-06-01')
    expect(out[1]!.day).toBe('2026-06-02')
  })

  it('rejects malformed day strings (falls back to empty string, never throws)', async () => {
    const aff = makeChain({ data: { id: 42 }, error: null })
    const rpcPayload = [
      { day: 'tomorrow',     clicks_count: '5', conversions_count: '1', revenue_cents: '1500' },
      { day: '12345abcde',   clicks_count: '0', conversions_count: '0', revenue_cents: '0' },
      { day: '',             clicks_count: '0', conversions_count: '0', revenue_cents: '0' },
    ]
    mockGetServerSupabase.mockResolvedValue(
      makeFakeSupabase({
        user: { id: 'u' },
        fromHandlers: { affiliates: () => aff.builder },
        rpcHandlers: {
          get_affiliate_daily_performance: rpcHandler(rpcPayload),
        },
      }),
    )
    const q = await loadQuery()
    const out = await q.getAffiliateDailyPerformance({ daysBack: 7 })
    expect(out).toHaveLength(3)
    expect(out.every((p) => p.day === '')).toBe(true)
  })
})

describe('getAffiliateDailyPerformance — defensive narrowing', () => {
  it('coerces null / number / NaN fields to 0', async () => {
    const aff = makeChain({ data: { id: 42 }, error: null })
    const rpcPayload = [
      {
        day: '2026-06-01',
        clicks_count: null,
        conversions_count: 'garbage',
        revenue_cents: undefined,
      },
    ]
    mockGetServerSupabase.mockResolvedValue(
      makeFakeSupabase({
        user: { id: 'u' },
        fromHandlers: { affiliates: () => aff.builder },
        rpcHandlers: {
          get_affiliate_daily_performance: rpcHandler(rpcPayload),
        },
      }),
    )
    const q = await loadQuery()
    const out = await q.getAffiliateDailyPerformance()
    expect(out[0]!.clicksCount).toBe(0)
    expect(out[0]!.conversionsCount).toBe(0)
    expect(out[0]!.revenueCents).toBe(0)
  })

  it('clamps negative numeric values to 0', async () => {
    const aff = makeChain({ data: { id: 42 }, error: null })
    const rpcPayload = [
      { day: '2026-06-01', clicks_count: -7, conversions_count: -2, revenue_cents: '-500' },
    ]
    mockGetServerSupabase.mockResolvedValue(
      makeFakeSupabase({
        user: { id: 'u' },
        fromHandlers: { affiliates: () => aff.builder },
        rpcHandlers: {
          get_affiliate_daily_performance: rpcHandler(rpcPayload),
        },
      }),
    )
    const q = await loadQuery()
    const out = await q.getAffiliateDailyPerformance()
    expect(out[0]!.clicksCount).toBe(0)
    expect(out[0]!.conversionsCount).toBe(0)
    expect(out[0]!.revenueCents).toBe(0)
  })

  it('returns [] when the RPC returns a non-array', async () => {
    const aff = makeChain({ data: { id: 42 }, error: null })
    mockGetServerSupabase.mockResolvedValue(
      makeFakeSupabase({
        user: { id: 'u' },
        fromHandlers: { affiliates: () => aff.builder },
        rpcHandlers: {
          get_affiliate_daily_performance: () =>
            Promise.resolve({ data: { not: 'an array' }, error: null }),
        },
      }),
    )
    const q = await loadQuery()
    const out = await q.getAffiliateDailyPerformance()
    expect(out).toEqual([])
  })
})

describe('getAffiliateDailyPerformance — fail-soft on RPC error', () => {
  it('returns [] and logs a warn with FNV-1a-hashed affiliate_id (never raw)', async () => {
    const aff = makeChain({ data: { id: 999 }, error: null })
    mockGetServerSupabase.mockResolvedValue(
      makeFakeSupabase({
        user: { id: 'u' },
        fromHandlers: { affiliates: () => aff.builder },
        rpcHandlers: {
          get_affiliate_daily_performance: () =>
            Promise.resolve({
              data: null,
              error: { code: 'PGRST500', message: 'oops' },
            }),
        },
      }),
    )
    const q = await loadQuery()
    const out = await q.getAffiliateDailyPerformance()
    expect(out).toEqual([])
    expect(mockWarn).toHaveBeenCalledTimes(1)
    const [payload, message] = mockWarn.mock.calls[0] as [
      Record<string, unknown>,
      string,
    ]
    expect(message).toBe('daily performance RPC failed')
    expect(payload.affiliate_id_hash).toBeTypeOf('string')
    expect(payload.affiliate_id_hash).toMatch(/^[0-9a-f]{8}$/)
    // Raw 999 MUST NOT appear in the payload.
    const flat = JSON.stringify(payload)
    expect(flat).not.toContain('999')
  })
})

describe('getAffiliateDailyPerformance — happy path is log-free', () => {
  it('does not log when the RPC succeeds', async () => {
    const aff = makeChain({ data: { id: 42 }, error: null })
    mockGetServerSupabase.mockResolvedValue(
      makeFakeSupabase({
        user: { id: 'u' },
        fromHandlers: { affiliates: () => aff.builder },
        rpcHandlers: {
          get_affiliate_daily_performance: rpcHandler([
            { day: '2026-06-01', clicks_count: '1', conversions_count: '0', revenue_cents: '0' },
          ]),
        },
      }),
    )
    const q = await loadQuery()
    await q.getAffiliateDailyPerformance()
    expect(mockWarn).not.toHaveBeenCalled()
  })
})
