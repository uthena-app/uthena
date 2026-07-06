// getMyCourseSalesSummary.test.ts — unit tests for
// `getMyCourseSalesSummary` (P12.11 Slice 1).
//
// Pattern follows getPartnerDashboardExtras.test.ts (P12.4):
// chainable fake Supabase + queued results + Pino mock with
// log-call capture.
//
// Coverage:
//   - **Input validation**: non-positive productId returns the empty
//     summary without DB calls.
//   - **Auth gating**: anon → empty summary, no DB calls past
//     auth.getUser.
//   - **Ownership short-circuit**: product row not found → empty
//     summary (fail-soft); product owned by another partner
//     (partner_id mismatch on partners table) → empty summary.
//   - **Ownership mismatch log**: when the product's partner_id
//     doesn't match the caller's partners.id, log a warn with
//     the hashed forms + the code, never log the raw partner_id.
//   - **Happy path**: maps RPC row into typed PartnerCourseSalesSummary.
//   - **Happy path — bigint string coercion**: PostgREST returns
//     numeric bigint fields as JSON strings; coerce back to JS
//     numbers.
//   - **Happy path — refund rate math**: rate is refundCount /
//     orderCount, clamped to [0, 1]. OrderCount=0 → rate=0.
//   - **Happy path — null avg_rating treated as null**: avg_raw null
//     or '0.00' string with no data stays null (no 0.00 fallback).
//   - **Happy path — missing first/last sale_at parsed as null**.
//   - **RPC fails**: returns empty summary + one warn log (fail-soft).
//   - **RPC returns non-array**: returns empty summary (defensive).
//   - **RPC returns empty array**: returns empty summary (defensive).
//   - **PII safety**: serialized logs never contain the partner_id
//     (42) or product_id (9001); only the hashed forms appear.

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

const PRODUCT_ID = 9001
const PARTNER_ID_ROW = { id: 42, user_id: 'user-1' }
const OWNED_PRODUCT_ROW = {
  id: PRODUCT_ID,
  partner_id: { id: 42, user_id: 'user-1' },
}

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

const { getMyCourseSalesSummary, emptyPartnerCourseSalesSummary } = await import(
  './getMyCourseSalesSummary'
)

// ===================================================================
// Input validation
// ===================================================================

describe('getMyCourseSalesSummary — input validation', () => {
  it('returns the empty summary without DB calls for productId <= 0', async () => {
    const result = await getMyCourseSalesSummary(0)
    expect(result).toEqual(emptyPartnerCourseSalesSummary())
    expect(fakeServerSupabase.from).not.toHaveBeenCalled()
    expect(fakeServerSupabase.rpc).not.toHaveBeenCalled()
  })

  it('returns the empty summary without DB calls for non-integer productId', async () => {
    const result = await getMyCourseSalesSummary(NaN)
    expect(result).toEqual(emptyPartnerCourseSalesSummary())
    expect(fakeServerSupabase.from).not.toHaveBeenCalled()
  })

  it('returns the empty summary without DB calls for negative productId', async () => {
    const result = await getMyCourseSalesSummary(-42)
    expect(result).toEqual(emptyPartnerCourseSalesSummary())
  })
})

// ===================================================================
// Auth gating
// ===================================================================

describe('getMyCourseSalesSummary — auth gating', () => {
  it('returns the empty summary when no user is signed in', async () => {
    mockUser = null
    fakeServerSupabase.auth.getUser.mockResolvedValueOnce({
      data: { user: null },
    })

    const result = await getMyCourseSalesSummary(PRODUCT_ID)
    expect(result).toEqual(emptyPartnerCourseSalesSummary())
    expect(fakeServerSupabase.from).not.toHaveBeenCalled()
    expect(fakeServerSupabase.rpc).not.toHaveBeenCalled()
  })

  it('returns the empty summary when the product is not found', async () => {
    serverQueue.push({ data: null, error: null }) // products SELECT → null

    const result = await getMyCourseSalesSummary(PRODUCT_ID)
    expect(result).toEqual(emptyPartnerCourseSalesSummary())
    expect(fakeServerSupabase.rpc).not.toHaveBeenCalled()
  })
})

// ===================================================================
// Ownership mismatch
// ===================================================================

describe('getMyCourseSalesSummary — ownership mismatch', () => {
  it('returns the empty summary (no RPC call) when the product partner_id differs from the caller', async () => {
    // products → owned by partner_id 99
    // partners → caller is partner_id 42
    serverQueue.push({
      data: { id: PRODUCT_ID, partner_id: { id: 99, user_id: 'someone-else' } },
      error: null,
    })
    serverQueue.push({ data: PARTNER_ID_ROW, error: null }) // partners lookup

    const result = await getMyCourseSalesSummary(PRODUCT_ID)
    expect(result).toEqual(emptyPartnerCourseSalesSummary())
    expect(fakeServerSupabase.rpc).not.toHaveBeenCalled()
    expect(logCalls).toHaveLength(1)
    expect(logCalls[0]?.msg).toBe(
      'partner requested a sales summary for a product they do not own (RLS should have hidden this)',
    )
  })

  it('emits a warn log with hashed partner_id + product_id (PII safety) on ownership mismatch', async () => {
    serverQueue.push({
      data: { id: PRODUCT_ID, partner_id: { id: 99, user_id: 'someone-else' } },
      error: null,
    })
    serverQueue.push({ data: PARTNER_ID_ROW, error: null })

    await getMyCourseSalesSummary(PRODUCT_ID)

    const serialized = JSON.stringify(logCalls)
    // Never leak the raw numeric ids
    expect(serialized).not.toContain('"id":42')
    expect(serialized).not.toContain('"productId":9001')
    expect(serialized).not.toContain('9001')
    expect(serialized).not.toContain('"partnerId":42')
    // Both hashed forms appear in the payload
    expect(serialized).toContain('partner_id_hash')
    expect(serialized).toContain('product_id_hash')
  })
})

// ===================================================================
// Happy path
// ===================================================================

describe('getMyCourseSalesSummary — happy path', () => {
  it('maps the RPC row into a typed PartnerCourseSalesSummary', async () => {
    serverQueue.push({ data: OWNED_PRODUCT_ROW, error: null })
    serverQueue.push({ data: PARTNER_ID_ROW, error: null })
    serverQueue.push({
      data: [
        {
          revenue_cents: '1250000',
          units_sold: '50',
          order_count: '40',
          refund_count: '3',
          avg_rating: '4.50',
          first_sale_at: '2026-01-15T10:00:00Z',
          last_sale_at: '2026-06-29T15:30:00Z',
        },
      ],
      error: null,
    })

    const result = await getMyCourseSalesSummary(PRODUCT_ID)
    expect(result).toEqual({
      revenueCents: 1_250_000,
      unitsSold: 50,
      orderCount: 40,
      refundCount: 3,
      refundRate: 3 / 40, // 0.075
      avgRating: 4.5,
      firstSaleAt: '2026-01-15T10:00:00.000Z',
      lastSaleAt: '2026-06-29T15:30:00.000Z',
    })

    // RPC should have been called with the resolved (partner_id, product_id).
    const rpcCalls = serverCalls.filter((c) => c.method === 'rpc')
    expect(rpcCalls.length).toBe(1)
    expect((rpcCalls[0] as { fn: string }).fn).toBe('get_partner_course_sales_summary')
    expect((rpcCalls[0] as { args: { p_partner_id: number; p_product_id: number } }).args).toEqual({
      p_partner_id: 42,
      p_product_id: 9001,
    })
  })

  it('coerces numeric (non-string) revenue_cents from RPC', async () => {
    serverQueue.push({ data: OWNED_PRODUCT_ROW, error: null })
    serverQueue.push({ data: PARTNER_ID_ROW, error: null })
    serverQueue.push({
      data: [
        {
          revenue_cents: 99_999, // raw number, not string
          units_sold: 1,
          order_count: 1,
          refund_count: 0,
          avg_rating: null,
          first_sale_at: null,
          last_sale_at: null,
        },
      ],
      error: null,
    })

    const result = await getMyCourseSalesSummary(PRODUCT_ID)
    expect(result.revenueCents).toBe(99_999)
    expect(result.unitsSold).toBe(1)
    expect(result.avgRating).toBeNull()
  })

  it('computes refundRate=0 when orderCount is zero', async () => {
    serverQueue.push({ data: OWNED_PRODUCT_ROW, error: null })
    serverQueue.push({ data: PARTNER_ID_ROW, error: null })
    serverQueue.push({
      data: [
        {
          revenue_cents: 0,
          units_sold: 0,
          order_count: 0,
          refund_count: 0,
          avg_rating: null,
          first_sale_at: null,
          last_sale_at: null,
        },
      ],
      error: null,
    })

    const result = await getMyCourseSalesSummary(PRODUCT_ID)
    expect(result.orderCount).toBe(0)
    expect(result.refundCount).toBe(0)
    expect(result.refundRate).toBe(0)
    // No divide-by-zero, no NaN.
    expect(Number.isFinite(result.refundRate)).toBe(true)
  })

  it('keeps avgRating=null when the product has no published reviews (NULL contract preserved)', async () => {
    serverQueue.push({ data: OWNED_PRODUCT_ROW, error: null })
    serverQueue.push({ data: PARTNER_ID_ROW, error: null })
    serverQueue.push({
      data: [
        {
          revenue_cents: 5000,
          units_sold: 2,
          order_count: 2,
          refund_count: 0,
          avg_rating: null, // SQL returns null when no rows
          first_sale_at: '2026-06-30T00:00:00Z',
          last_sale_at: '2026-06-30T00:00:00Z',
        },
      ],
      error: null,
    })

    const result = await getMyCourseSalesSummary(PRODUCT_ID)
    expect(result.avgRating).toBeNull()
  })

  it('parses missing first_sale_at / last_sale_at as null', async () => {
    serverQueue.push({ data: OWNED_PRODUCT_ROW, error: null })
    serverQueue.push({ data: PARTNER_ID_ROW, error: null })
    serverQueue.push({
      data: [
        {
          revenue_cents: 0,
          units_sold: 0,
          order_count: 0,
          refund_count: 0,
          avg_rating: null,
          first_sale_at: null,
          last_sale_at: null,
        },
      ],
      error: null,
    })

    const result = await getMyCourseSalesSummary(PRODUCT_ID)
    expect(result.firstSaleAt).toBeNull()
    expect(result.lastSaleAt).toBeNull()
  })

  it('clamps refundRate to [0, 1] when the underlying data is malformed', async () => {
    serverQueue.push({ data: OWNED_PRODUCT_ROW, error: null })
    serverQueue.push({ data: PARTNER_ID_ROW, error: null })
    serverQueue.push({
      data: [
        {
          revenue_cents: 0,
          units_sold: 0,
          order_count: 1,
          refund_count: 5, // ratio = 5.0 — pathological case
          avg_rating: null,
          first_sale_at: null,
          last_sale_at: null,
        },
      ],
      error: null,
    })

    const result = await getMyCourseSalesSummary(PRODUCT_ID)
    expect(result.refundRate).toBe(1) // clamped, not 5
  })
})

// ===================================================================
// RPC failure handling
// ===================================================================

describe('getMyCourseSalesSummary — RPC failure handling', () => {
  it('returns the empty summary + emits one warn log when the RPC errors out', async () => {
    serverQueue.push({ data: OWNED_PRODUCT_ROW, error: null })
    serverQueue.push({ data: PARTNER_ID_ROW, error: null })
    serverQueue.push({
      data: null,
      error: { message: 'connection refused', code: 'PGRST301' },
    })

    const result = await getMyCourseSalesSummary(PRODUCT_ID)
    expect(result).toEqual(emptyPartnerCourseSalesSummary())

    const warnCalls = logCalls.filter((c) => c.level === 'warn')
    expect(warnCalls.length).toBe(1)
    expect(warnCalls[0]?.msg).toBe('course sales summary RPC failed')
  })

  it('returns the empty summary (no log) when the RPC returns a non-array', async () => {
    serverQueue.push({ data: OWNED_PRODUCT_ROW, error: null })
    serverQueue.push({ data: PARTNER_ID_ROW, error: null })
    serverQueue.push({ data: { unexpected: 'shape' }, error: null })

    const result = await getMyCourseSalesSummary(PRODUCT_ID)
    expect(result).toEqual(emptyPartnerCourseSalesSummary())
    expect(logCalls).toHaveLength(0)
  })

  it('returns the empty summary (no log) when the RPC returns an empty array', async () => {
    serverQueue.push({ data: OWNED_PRODUCT_ROW, error: null })
    serverQueue.push({ data: PARTNER_ID_ROW, error: null })
    serverQueue.push({ data: [], error: null })

    const result = await getMyCourseSalesSummary(PRODUCT_ID)
    expect(result).toEqual(emptyPartnerCourseSalesSummary())
  })

  it('NEVER logs raw partner_id or product_id on RPC failure — only the hashed forms (PII safety)', async () => {
    serverQueue.push({ data: OWNED_PRODUCT_ROW, error: null })
    serverQueue.push({ data: PARTNER_ID_ROW, error: null })
    serverQueue.push({
      data: null,
      error: { message: 'boom', code: 'XX' },
    })

    await getMyCourseSalesSummary(PRODUCT_ID)

    const serialized = JSON.stringify(logCalls)
    expect(serialized).not.toContain('"partner_id":42')
    expect(serialized).not.toContain('"id":42')
    expect(serialized).not.toContain('"product_id":9001')
    expect(serialized).not.toContain('"productId":9001')
    expect(serialized).toContain('partner_id_hash')
    expect(serialized).toContain('product_id_hash')
  })
})
