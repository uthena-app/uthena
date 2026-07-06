// getPartnerDashboardExtras.test.ts — unit tests for
// getPartnerRecentActivity + getPartnerDailySalesSeries (P12.4).
//
// Pattern follows getMyPartnerProfile.test.ts (P6.1 / P6.5 / P12.4):
// chainable fake Supabase + queued results + Pino mock with
// log-call capture.
//
// Coverage:
//   - **Auth gating (both helpers)**: anon → [] (no DB calls past
//     auth.getUser); missing partners row → [] (no RPC).
//   - **Activity feed — happy path**: maps the RPC's row shape into
//     a typed PartnerActivityEntry with coerced bigints.
//   - **Activity feed — kind normalization**: snake_case → camelCase
//     via normalizeEventKind; unknown kinds fall through to 'sale'.
//   - **Activity feed — RPC fails**: returns [] + one warn log.
//   - **Activity feed — empty array**: returns [].
//   - **Activity feed — non-array data**: returns [] (defensive).
//   - **Activity feed — limit forwarding**: p_limit matches the
//     opts.limit passed in.
//   - **Earnings series — happy path**: returns N points with each
//     day filled.
//   - **Earnings series — day coercion**: full ISO date string
//     `YYYY-MM-DDTHH:MM:SSZ` is accepted (PostgREST date form).
//   - **Earnings series — RPC fails**: returns [] + one warn log.
//   - **Earnings series — non-array data**: returns [].
//   - **daysBack default of 30**: assert p_days_back=30 when omitted.
//   - **PII safety**: serialized logs never contain the partner_id
//     (42); only the hashed form appears.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ----- Mocks ---------------------------------------------------------------

type ServerCall =
  | { method: 'from'; table: string }
  | { method: 'select'; payload: unknown }
  | { method: 'eq'; col: string; val: unknown }
  | { method: 'maybeSingle' }
  | { method: 'rpc'; fn: string; args: unknown }

const serverCalls: ServerCall[] = []
let serverQueue: Array<{ data: unknown; error: unknown }> = []

function makeServerChain() {
  const chain: any = {
    select(payload: unknown) {
      serverCalls.push({ method: 'select', payload })
      return chain
    },
    eq(col: string, val: unknown) {
      serverCalls.push({ method: 'eq', col, val })
      return chain
    },
    maybeSingle: vi.fn(async () => {
      serverCalls.push({ method: 'maybeSingle' })
      return serverQueue.shift() ?? { data: null, error: null }
    }),
  }
  return chain
}

const fakeServerSupabase = {
  from: vi.fn((table: string) => {
    serverCalls.push({ method: 'from', table })
    return makeServerChain()
  }),
  rpc: vi.fn((fn: string, args: unknown) => {
    serverCalls.push({ method: 'rpc', fn, args })
    return Promise.resolve(serverQueue.shift() ?? { data: null, error: null })
  }),
  auth: {
    getUser: vi.fn(async () => ({ data: { user: mockUser } })),
  },
}

vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: vi.fn(async () => fakeServerSupabase),
}))

// ----- Logger mock (PII-safety assertions) --------------------------------

const logCalls: Array<{
  level: 'info' | 'warn' | 'error' | 'debug'
  payload: Record<string, unknown>
  msg?: string | undefined
}> = []
vi.mock('@foundations/log/pino', () => ({
  loggerFor: () => ({
    info: (payload: Record<string, unknown>, msg?: string) =>
      logCalls.push({ level: 'info', payload, msg }),
    warn: (payload: Record<string, unknown>, msg?: string) =>
      logCalls.push({ level: 'warn', payload, msg }),
    error: (payload: Record<string, unknown>, msg?: string) =>
      logCalls.push({ level: 'error', payload, msg }),
    debug: (payload: Record<string, unknown>, msg?: string) =>
      logCalls.push({ level: 'debug', payload, msg }),
  }),
}))

// ----- Test state ---------------------------------------------------------

let mockUser: { id: string; email: string | null } | null = {
  id: 'user-1',
  email: 'partner@example.com',
}

const PARTNER_ID_ROW = { id: 42 }

beforeEach(() => {
  serverCalls.length = 0
  serverQueue = []
  logCalls.length = 0
  mockUser = { id: 'user-1', email: 'partner@example.com' }
  fakeServerSupabase.from.mockClear()
  fakeServerSupabase.rpc.mockClear()
  fakeServerSupabase.auth.getUser.mockClear()
  fakeServerSupabase.auth.getUser.mockImplementation(async () => ({
    data: { user: mockUser },
  }))
})

afterEach(() => {
  vi.clearAllMocks()
})

// ----- Import (after mocks) -----------------------------------------------

const {
  getPartnerRecentActivity,
  getPartnerDailySalesSeries,
} = await import('./getPartnerDashboardExtras')

// ===================================================================
// getPartnerRecentActivity — auth gating
// ===================================================================

describe('getPartnerRecentActivity — auth gating', () => {
  it('returns [] when no user is signed in', async () => {
    mockUser = null
    fakeServerSupabase.auth.getUser.mockResolvedValueOnce({
      data: { user: null },
    })

    const result = await getPartnerRecentActivity()
    expect(result).toEqual([])
  })

  it('returns [] when the partners row is not found (no partner yet)', async () => {
    serverQueue.push({ data: null, error: null }) // partners SELECT → null

    const result = await getPartnerRecentActivity()
    expect(result).toEqual([])
    // No RPC should have been called
    const rpcCalls = serverCalls.filter((c) => c.method === 'rpc')
    expect(rpcCalls.length).toBe(0)
  })

  it('returns [] when the partners SELECT errors out (fail-soft)', async () => {
    serverQueue.push({ data: null, error: { message: 'blip', code: 'PGRST301' } })

    const result = await getPartnerRecentActivity()
    expect(result).toEqual([])
    expect(logCalls).toHaveLength(0) // SELECT error doesn't log; only RPC error logs
  })
})

// ===================================================================
// getPartnerRecentActivity — happy path
// ===================================================================

describe('getPartnerRecentActivity — happy path', () => {
  it('maps RPC rows into typed PartnerActivityEntry', async () => {
    serverQueue.push({ data: PARTNER_ID_ROW, error: null }) // partners SELECT
    serverQueue.push({
      data: [
        {
          event_at: '2026-06-29T10:00:00Z',
          event_kind: 'order_sale',
          description: 'New sale',
          amount_cents: 5000,
          product_title: 'Best Course',
          order_id: '9001',
        },
        {
          event_at: '2026-06-28T15:30:00Z',
          event_kind: 'refund',
          description: 'Refund',
          amount_cents: -2500,
          product_title: 'Another Course',
          order_id: '9002',
        },
      ],
      error: null,
    })

    const result = await getPartnerRecentActivity({ limit: 10 })
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({
      eventAt: '2026-06-29T10:00:00Z',
      kind: 'sale',
      description: 'New sale',
      amountCents: 5000,
      productTitle: 'Best Course',
      orderId: 9001,
    })
    expect(result[1]).toEqual({
      eventAt: '2026-06-28T15:30:00Z',
      kind: 'refund',
      description: 'Refund',
      amountCents: -2500,
      productTitle: 'Another Course',
      orderId: 9002,
    })
  })

  it('coerces bigint-as-string amounts (PostgREST wire form)', async () => {
    serverQueue.push({ data: PARTNER_ID_ROW, error: null })
    serverQueue.push({
      data: [
        {
          event_at: '2026-06-29T10:00:00Z',
          event_kind: 'order_sale',
          description: 'New sale',
          amount_cents: '12500', // stringified bigint
          product_title: 'Course',
          order_id: '9001',
        },
      ],
      error: null,
    })

    const result = await getPartnerRecentActivity()
    expect(result[0]?.amountCents).toBe(12_500)
    expect(result[0]?.orderId).toBe(9001)
  })

  it('normalizes snake_case event_kind to camelCase PartnerActivityKind', async () => {
    serverQueue.push({ data: PARTNER_ID_ROW, error: null })
    serverQueue.push({
      data: [
        { event_at: '2026-06-29T10:00:00Z', event_kind: 'order_sale',   description: 'New sale',       amount_cents: 100,  product_title: null, order_id: null },
        { event_at: '2026-06-29T10:01:00Z', event_kind: 'refund',       description: 'Refund',          amount_cents: -50,  product_title: null, order_id: null },
        { event_at: '2026-06-29T10:02:00Z', event_kind: 'payout',       description: 'Payout sent',     amount_cents: 0,    product_title: null, order_id: null },
        { event_at: '2026-06-29T10:03:00Z', event_kind: 'clawback',     description: 'Clawback',        amount_cents: -75,  product_title: null, order_id: null },
        { event_at: '2026-06-29T10:04:00Z', event_kind: 'adjustment',   description: 'Adjustment',      amount_cents: 25,   product_title: null, order_id: null },
        { event_at: '2026-06-29T10:05:00Z', event_kind: 'subscription', description: 'Subscription',    amount_cents: 0,    product_title: null, order_id: null },
      ],
      error: null,
    })

    const result = await getPartnerRecentActivity()
    const kinds = result.map((r) => r.kind)
    expect(kinds).toEqual([
      'sale',
      'refund',
      'payout',
      'clawback',
      'adjustment',
      'subscription',
    ])
  })

  it('falls back to kind="sale" for unknown event_kind strings (defensive)', async () => {
    serverQueue.push({ data: PARTNER_ID_ROW, error: null })
    serverQueue.push({
      data: [
        { event_at: '2026-06-29T10:00:00Z', event_kind: 'future_kind_value', description: '?', amount_cents: 0, product_title: null, order_id: null },
      ],
      error: null,
    })

    const result = await getPartnerRecentActivity()
    expect(result[0]?.kind).toBe('sale')
  })

  it('returns [] when the RPC returns an empty array', async () => {
    serverQueue.push({ data: PARTNER_ID_ROW, error: null })
    serverQueue.push({ data: [], error: null })

    const result = await getPartnerRecentActivity()
    expect(result).toEqual([])
  })

  it('returns [] when the RPC returns a non-array (defensive)', async () => {
    serverQueue.push({ data: PARTNER_ID_ROW, error: null })
    serverQueue.push({ data: { unexpected: 'shape' }, error: null })

    const result = await getPartnerRecentActivity()
    expect(result).toEqual([])
  })

  it('treats null product_title / null order_id as null in the result', async () => {
    serverQueue.push({ data: PARTNER_ID_ROW, error: null })
    serverQueue.push({
      data: [
        {
          event_at: '2026-06-29T10:00:00Z',
          event_kind: 'payout',
          description: 'Payout sent',
          amount_cents: 50000,
          product_title: null,
          order_id: null,
        },
      ],
      error: null,
    })

    const result = await getPartnerRecentActivity()
    expect(result[0]?.productTitle).toBeNull()
    expect(result[0]?.orderId).toBeNull()
  })

  it('forwards opts.limit to p_limit on the RPC', async () => {
    serverQueue.push({ data: PARTNER_ID_ROW, error: null })
    serverQueue.push({ data: [], error: null })

    await getPartnerRecentActivity({ limit: 25 })

    const rpcCalls = serverCalls.filter((c) => c.method === 'rpc')
    expect(rpcCalls.length).toBe(1)
    expect((rpcCalls[0] as { fn: string }).fn).toBe('get_partner_recent_activity')
    expect((rpcCalls[0] as { args: { p_partner_id: number; p_limit: number } }).args).toEqual({
      p_partner_id: 42,
      p_limit: 25,
    })
  })

  it('defaults to p_limit=10 when opts.limit is omitted', async () => {
    serverQueue.push({ data: PARTNER_ID_ROW, error: null })
    serverQueue.push({ data: [], error: null })

    await getPartnerRecentActivity()

    const rpcCalls = serverCalls.filter((c) => c.method === 'rpc')
    expect((rpcCalls[0] as { args: { p_limit: number } }).args.p_limit).toBe(10)
  })
})

// ===================================================================
// getPartnerRecentActivity — RPC failure handling
// ===================================================================

describe('getPartnerRecentActivity — RPC failure handling', () => {
  it('returns [] + emits one warn log when the RPC errors out', async () => {
    serverQueue.push({ data: PARTNER_ID_ROW, error: null })
    serverQueue.push({
      data: null,
      error: { message: 'connection refused', code: 'PGRST301' },
    })

    const result = await getPartnerRecentActivity()
    expect(result).toEqual([])

    const warnCalls = logCalls.filter((c) => c.level === 'warn')
    expect(warnCalls.length).toBe(1)
    expect(warnCalls[0]?.msg).toBe('recent activity RPC failed')
  })

  it('NEVER logs the raw partner_id — only the hashed form (PII safety)', async () => {
    serverQueue.push({ data: PARTNER_ID_ROW, error: null })
    serverQueue.push({
      data: null,
      error: { message: 'boom', code: 'XX' },
    })

    await getPartnerRecentActivity()

    const serialized = JSON.stringify(logCalls)
    expect(serialized).not.toContain('"partner_id":42')
    expect(serialized).not.toContain('"id":42')
    expect(serialized).toContain('partner_id_hash')
  })
})

// ===================================================================
// getPartnerDailySalesSeries — auth gating
// ===================================================================

describe('getPartnerDailySalesSeries — auth gating', () => {
  it('returns [] when no user is signed in', async () => {
    mockUser = null
    fakeServerSupabase.auth.getUser.mockResolvedValueOnce({
      data: { user: null },
    })

    const result = await getPartnerDailySalesSeries()
    expect(result).toEqual([])
  })

  it('returns [] when the partners row is not found', async () => {
    serverQueue.push({ data: null, error: null })

    const result = await getPartnerDailySalesSeries()
    expect(result).toEqual([])
    const rpcCalls = serverCalls.filter((c) => c.method === 'rpc')
    expect(rpcCalls.length).toBe(0)
  })
})

// ===================================================================
// getPartnerDailySalesSeries — happy path
// ===================================================================

describe('getPartnerDailySalesSeries — happy path', () => {
  it('maps RPC rows into typed PartnerSalesSeriesPoint', async () => {
    serverQueue.push({ data: PARTNER_ID_ROW, error: null })
    serverQueue.push({
      data: [
        { day: '2026-06-01', sales_cents: 1000,  order_count: 1 },
        { day: '2026-06-02', sales_cents: 0,     order_count: 0 },
        { day: '2026-06-03', sales_cents: 5000,  order_count: 3 },
      ],
      error: null,
    })

    const result = await getPartnerDailySalesSeries({ daysBack: 7 })
    expect(result).toHaveLength(3)
    expect(result[0]).toEqual({ day: '2026-06-01', salesCents: 1000, orderCount: 1 })
    expect(result[1]).toEqual({ day: '2026-06-02', salesCents: 0,    orderCount: 0 })
    expect(result[2]).toEqual({ day: '2026-06-03', salesCents: 5000, orderCount: 3 })
  })

  it('coerces full ISO date strings to YYYY-MM-DD prefix (PostgREST date form)', async () => {
    serverQueue.push({ data: PARTNER_ID_ROW, error: null })
    serverQueue.push({
      data: [{ day: '2026-06-01T00:00:00+00:00', sales_cents: 0, order_count: 0 }],
      error: null,
    })

    const result = await getPartnerDailySalesSeries({ daysBack: 7 })
    expect(result[0]?.day).toBe('2026-06-01')
  })

  it('coerces bigint-as-string sales_cents (PostgREST wire form)', async () => {
    serverQueue.push({ data: PARTNER_ID_ROW, error: null })
    serverQueue.push({
      data: [{ day: '2026-06-01', sales_cents: '12500', order_count: '3' }],
      error: null,
    })

    const result = await getPartnerDailySalesSeries({ daysBack: 7 })
    expect(result[0]?.salesCents).toBe(12_500)
    expect(result[0]?.orderCount).toBe(3)
  })

  it('returns [] when the RPC returns an empty array', async () => {
    serverQueue.push({ data: PARTNER_ID_ROW, error: null })
    serverQueue.push({ data: [], error: null })

    const result = await getPartnerDailySalesSeries()
    expect(result).toEqual([])
  })

  it('returns [] when the RPC returns a non-array (defensive)', async () => {
    serverQueue.push({ data: PARTNER_ID_ROW, error: null })
    serverQueue.push({ data: 'unexpected-shape', error: null })

    const result = await getPartnerDailySalesSeries()
    expect(result).toEqual([])
  })

  it('falls back to empty day string when day is null (defensive coercion)', async () => {
    serverQueue.push({ data: PARTNER_ID_ROW, error: null })
    serverQueue.push({
      data: [{ day: null, sales_cents: 0, order_count: 0 }],
      error: null,
    })

    const result = await getPartnerDailySalesSeries({ daysBack: 7 })
    expect(result[0]?.day).toBe('')
  })

  it('forwards opts.daysBack to p_days_back on the RPC', async () => {
    serverQueue.push({ data: PARTNER_ID_ROW, error: null })
    serverQueue.push({ data: [], error: null })

    await getPartnerDailySalesSeries({ daysBack: 14 })

    const rpcCalls = serverCalls.filter((c) => c.method === 'rpc')
    expect(rpcCalls.length).toBe(1)
    expect((rpcCalls[0] as { fn: string }).fn).toBe('get_partner_daily_sales_series')
    expect((rpcCalls[0] as { args: { p_partner_id: number; p_days_back: number } }).args).toEqual({
      p_partner_id: 42,
      p_days_back: 14,
    })
  })

  it('defaults to p_days_back=30 when opts.daysBack is omitted', async () => {
    serverQueue.push({ data: PARTNER_ID_ROW, error: null })
    serverQueue.push({ data: [], error: null })

    await getPartnerDailySalesSeries()

    const rpcCalls = serverCalls.filter((c) => c.method === 'rpc')
    expect((rpcCalls[0] as { args: { p_days_back: number } }).args.p_days_back).toBe(30)
  })
})

// ===================================================================
// getPartnerDailySalesSeries — RPC failure handling
// ===================================================================

describe('getPartnerDailySalesSeries — RPC failure handling', () => {
  it('returns [] + emits one warn log when the RPC errors out', async () => {
    serverQueue.push({ data: PARTNER_ID_ROW, error: null })
    serverQueue.push({
      data: null,
      error: { message: 'connection refused', code: 'PGRST301' },
    })

    const result = await getPartnerDailySalesSeries()
    expect(result).toEqual([])

    const warnCalls = logCalls.filter((c) => c.level === 'warn')
    expect(warnCalls.length).toBe(1)
    expect(warnCalls[0]?.msg).toBe('daily sales series RPC failed')
  })

  it('NEVER logs the raw partner_id — only the hashed form (PII safety)', async () => {
    serverQueue.push({ data: PARTNER_ID_ROW, error: null })
    serverQueue.push({
      data: null,
      error: { message: 'boom', code: 'XX' },
    })

    await getPartnerDailySalesSeries()

    const serialized = JSON.stringify(logCalls)
    expect(serialized).not.toContain('"partner_id":42')
    expect(serialized).not.toContain('"id":42')
    expect(serialized).toContain('partner_id_hash')
  })
})
