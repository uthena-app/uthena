// getPartnerLedgerEntry.test.ts — unit tests for getPartnerLedgerEntry (P6.4).
//
// Covers:
//   - **Input validation (Zod)**: invalid ids (negative, zero, non-
//     numeric, NaN, empty string, malformed strings) return null
//     without hitting the DB.
//   - **Auth gating**: no session user → null; no DB call.
//   - **Entry not found**: empty result → null; error result → null
//     (fail-soft).
//   - **Happy path — order_sale row**: full entry mapped + order
//     joined + timezone surfaced.
//   - **Happy path — refund row**: refund joined even when entry
//     has no order_id (refund_id drives the join).
//   - **Happy path — adjustment row** (no order, no refund): the
//     entry surfaces with null joins; no extra DB calls.
//   - **PII safety**: orders.email is NOT selected (asserted on the
//     captured call list); refund.notes is OK to return (not PII).
//   - **PII in logs**: hashed id only, no raw partner_id / user_id
//     / email in any log payload.
//   - **Refund-row-missing-refund_id data inconsistency**: warns
//     but does not throw.
//   - **Order + refund fail-soft**: error from the join read does
//     not break the response; the entry still returns.
//   - **Timezone passthrough**: missing profile / null column /
//     empty string all fall back to 'UTC'.
//
// Pattern follows `getPartnerLedger.test.ts` (P6.3) — chainable
// fake Supabase + queued results + Pino mock with log-call capture.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ----- Mocks ---------------------------------------------------------------

type ServerCall =
  | { method: 'from'; table: string }
  | { method: 'select'; payload: unknown }
  | { method: 'eq'; col: string; val: unknown }
  | { method: 'maybeSingle' }

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
    maybeSingle() {
      serverCalls.push({ method: 'maybeSingle' })
      const next = serverQueue.shift() ?? { data: null, error: null }
      return Promise.resolve(next)
    },
  }
  return chain
}

const getServerSupabaseMock = vi.fn(async () => ({
  from(_table: string) {
    serverCalls.push({ method: 'from', table: _table })
    return makeServerChain()
  },
}))

const getSessionUserMock = vi.fn()

const logCalls: Array<{ level: string; payload: Record<string, unknown>; msg: string }> = []
vi.mock('@foundations/log/pino', () => ({
  loggerFor: () => ({
    warn: (payload: Record<string, unknown>, msg: string) => {
      logCalls.push({ level: 'warn', payload, msg })
    },
    info: (payload: Record<string, unknown>, msg: string) => {
      logCalls.push({ level: 'info', payload, msg })
    },
    error: (payload: Record<string, unknown>, msg: string) => {
      logCalls.push({ level: 'error', payload, msg })
    },
    debug: () => {},
  }),
}))

vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: () => getServerSupabaseMock(),
}))

vi.mock('@foundations/auth/guards', () => ({
  getSessionUser: () => getSessionUserMock(),
}))

// ----- Setup --------------------------------------------------------------

beforeEach(() => {
  serverCalls.length = 0
  serverQueue = []
  logCalls.length = 0
  getServerSupabaseMock.mockClear()
  getSessionUserMock.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

// ----- Helpers ------------------------------------------------------------

function load() {
  return import('./getPartnerLedgerEntry').then((m) => m.getPartnerLedgerEntry)
}

const SALE_ROW = {
  id: 42,
  created_at: '2026-06-15T12:34:56.000Z',
  kind: 'order_sale',
  status: 'locked',
  amount_cents: 4500,
  currency: 'USD',
  description: 'Sale: Beginner Yoga Course',
  order_id: 100,
  order_item_id: 200,
  refund_id: null,
  royalty_pct_bps: 3000,
  locked_until: '2026-06-29T12:34:56.000Z',
  available_at: '2026-06-29T12:34:56.000Z',
  paid_at: null,
  paypal_payout_batch_id: null,
  stripe_transfer_id: null,
}

const ORDER_ROW = {
  id: 100,
  status: 'paid',
  subtotal_cents: 15000,
  discount_cents: 0,
  tax_cents: 0,
  total_cents: 15000,
  currency: 'USD',
  paid_at: '2026-06-15T12:34:56.000Z',
  fulfilled_at: '2026-06-15T12:35:00.000Z',
  created_at: '2026-06-15T12:34:50.000Z',
  refunded_cents: 0,
}

// ----- Tests --------------------------------------------------------------

describe('getPartnerLedgerEntry — input validation', () => {
  it('returns null on non-numeric id (no DB call)', async () => {
    const fn = await load()
    const out = await fn('not-a-number')
    expect(out).toBeNull()
    expect(serverCalls).toHaveLength(0)
    expect(getSessionUserMock).not.toHaveBeenCalled()
  })

  it('returns null on negative id (no DB call)', async () => {
    const fn = await load()
    const out = await fn(-1)
    expect(out).toBeNull()
    expect(serverCalls).toHaveLength(0)
  })

  it('returns null on zero id (no DB call)', async () => {
    const fn = await load()
    const out = await fn(0)
    expect(out).toBeNull()
    expect(serverCalls).toHaveLength(0)
  })

  it('returns null on NaN id (no DB call)', async () => {
    const fn = await load()
    const out = await fn(Number.NaN)
    expect(out).toBeNull()
    expect(serverCalls).toHaveLength(0)
  })

  it('returns null on empty string id (no DB call)', async () => {
    const fn = await load()
    const out = await fn('')
    expect(out).toBeNull()
    expect(serverCalls).toHaveLength(0)
  })

  it('coerces numeric string to number', async () => {
    getSessionUserMock.mockResolvedValue({ id: 'u1', email: 'a@b.c', role: 'partner', display_name: 'X' })
    serverQueue = [
      { data: SALE_ROW, error: null }, // entry
      { data: { timezone: 'Asia/Tokyo' }, error: null }, // profile
      { data: ORDER_ROW, error: null }, // order
    ]
    const fn = await load()
    const out = await fn('42')
    expect(out).not.toBeNull()
    expect(out?.entry.id).toBe(42)
  })
})

describe('getPartnerLedgerEntry — auth gating', () => {
  it('returns null when no session user (no DB calls)', async () => {
    getSessionUserMock.mockResolvedValue(null)
    const fn = await load()
    const out = await fn(42)
    expect(out).toBeNull()
    // getSessionUser is called but no Supabase reads follow.
    const fromCalls = serverCalls.filter((c) => c.method === 'from')
    expect(fromCalls).toHaveLength(0)
  })
})

describe('getPartnerLedgerEntry — entry lookup', () => {
  it('returns null on empty entry result', async () => {
    getSessionUserMock.mockResolvedValue({ id: 'u1', email: 'a@b.c', role: 'partner', display_name: 'X' })
    serverQueue = [
      { data: null, error: null }, // entry (not found)
      { data: { timezone: 'UTC' }, error: null }, // profile
    ]
    const fn = await load()
    const out = await fn(42)
    expect(out).toBeNull()
  })

  it('returns null on entry read error (fail-soft, warn logged)', async () => {
    getSessionUserMock.mockResolvedValue({ id: 'u1', email: 'a@b.c', role: 'partner', display_name: 'X' })
    serverQueue = [
      { data: null, error: { message: 'connection refused', code: '08006' } }, // entry error
      // profile read still happens — we did Promise.all on both, but
      // .maybeSingle() consumes each queue slot synchronously during
      // chain construction.
      { data: { timezone: 'UTC' }, error: null },
    ]
    const fn = await load()
    const out = await fn(42)
    expect(out).toBeNull()
    expect(logCalls.some((c) => c.payload?.code === 'ledger_entry_read_failed')).toBe(true)
  })
})

describe('getPartnerLedgerEntry — happy path (order_sale)', () => {
  it('maps the entry + joins order + surfaces timezone', async () => {
    getSessionUserMock.mockResolvedValue({ id: 'u1', email: 'a@b.c', role: 'partner', display_name: 'X' })
    serverQueue = [
      { data: SALE_ROW, error: null }, // entry
      { data: { timezone: 'America/Los_Angeles' }, error: null }, // profile
      { data: ORDER_ROW, error: null }, // order
    ]
    const fn = await load()
    const out = await fn(42)
    expect(out).not.toBeNull()
    expect(out?.entry.id).toBe(42)
    expect(out?.entry.kind).toBe('order_sale')
    expect(out?.entry.amount_cents).toBe(4500)
    expect(out?.entry.royalty_pct_bps).toBe(3000)
    expect(out?.entry.locked_until).toBe('2026-06-29T12:34:56.000Z')
    expect(out?.entry.refund_id).toBeNull()
    expect(out?.order).not.toBeNull()
    expect(out?.order?.id).toBe(100)
    expect(out?.order?.total_cents).toBe(15000)
    expect(out?.order?.status).toBe('paid')
    expect(out?.refund).toBeNull()
    expect(out?.timezone).toBe('America/Los_Angeles')
  })

  it('asserts orders.email is NOT selected (PII safety)', async () => {
    getSessionUserMock.mockResolvedValue({ id: 'u1', email: 'a@b.c', role: 'partner', display_name: 'X' })
    serverQueue = [
      { data: SALE_ROW, error: null },
      { data: { timezone: 'UTC' }, error: null },
      { data: ORDER_ROW, error: null },
    ]
    const fn = await load()
    await fn(42)
    const ordersSelect = serverCalls.find(
      (c) => c.method === 'select' && typeof (c as { payload?: unknown }).payload === 'string' && String((c as { payload: string }).payload).includes('total_cents'),
    )
    expect(ordersSelect).toBeDefined()
    const selectPayload = String((ordersSelect as { payload: string }).payload)
    expect(selectPayload).not.toContain('email')
    expect(selectPayload).not.toContain('ip')
    expect(selectPayload).not.toContain('user_agent')
  })

  it('asserts entry query is filtered by id (eq)', async () => {
    getSessionUserMock.mockResolvedValue({ id: 'u1', email: 'a@b.c', role: 'partner', display_name: 'X' })
    serverQueue = [
      { data: SALE_ROW, error: null },
      { data: { timezone: 'UTC' }, error: null },
      { data: ORDER_ROW, error: null },
    ]
    const fn = await load()
    await fn(42)
    const idEq = serverCalls.find(
      (c) => c.method === 'eq' && c.col === 'id' && c.val === 42,
    )
    expect(idEq).toBeDefined()
  })
})

describe('getPartnerLedgerEntry — happy path (refund)', () => {
  it('joins refund row when refund_id is set', async () => {
    const REFUND_ROW = {
      id: 555,
      order_id: 100,
      amount_cents: 15000,
      reason: 'requested_by_customer',
      notes: 'Changed mind',
      status: 'succeeded',
      stripe_refund_id: 're_abc123',
      approved_at: '2026-06-16T10:00:00.000Z',
      processed_at: '2026-06-16T10:05:00.000Z',
      created_at: '2026-06-16T09:55:00.000Z',
    }
    getSessionUserMock.mockResolvedValue({ id: 'u1', email: 'a@b.c', role: 'partner', display_name: 'X' })
    serverQueue = [
      { data: { ...SALE_ROW, kind: 'refund', amount_cents: -4500, refund_id: 555, order_id: 100 }, error: null },
      { data: { timezone: 'UTC' }, error: null },
      { data: ORDER_ROW, error: null }, // order join
      { data: REFUND_ROW, error: null }, // refund join
    ]
    const fn = await load()
    const out = await fn(42)
    expect(out?.entry.kind).toBe('refund')
    expect(out?.entry.amount_cents).toBe(-4500)
    expect(out?.refund?.id).toBe(555)
    expect(out?.refund?.reason).toBe('requested_by_customer')
    expect(out?.refund?.stripe_refund_id).toBe('re_abc123')
    expect(out?.order?.id).toBe(100)
  })
})

describe('getPartnerLedgerEntry — happy path (adjustment, no joins)', () => {
  it('surfaces entry with null order + null refund when both ids are null', async () => {
    getSessionUserMock.mockResolvedValue({ id: 'u1', email: 'a@b.c', role: 'partner', display_name: 'X' })
    serverQueue = [
      {
        data: {
          ...SALE_ROW,
          kind: 'adjustment',
          order_id: null,
          order_item_id: null,
          refund_id: null,
          amount_cents: 100,
        },
        error: null,
      },
      { data: { timezone: 'UTC' }, error: null },
      // No order queue entry — Promise.all with null branches
      // resolves immediately. No refund queue entry either.
    ]
    const fn = await load()
    const out = await fn(42)
    expect(out?.entry.kind).toBe('adjustment')
    expect(out?.entry.order_id).toBeNull()
    expect(out?.entry.refund_id).toBeNull()
    expect(out?.order).toBeNull()
    expect(out?.refund).toBeNull()
  })
})

describe('getPartnerLedgerEntry — fail-soft joins', () => {
  it('returns null order + entry when order join errors', async () => {
    getSessionUserMock.mockResolvedValue({ id: 'u1', email: 'a@b.c', role: 'partner', display_name: 'X' })
    serverQueue = [
      { data: SALE_ROW, error: null },
      { data: { timezone: 'UTC' }, error: null },
      { data: null, error: { message: 'order missing', code: 'PGRST116' } }, // order error
    ]
    const fn = await load()
    const out = await fn(42)
    expect(out?.entry.id).toBe(42)
    expect(out?.order).toBeNull()
    expect(out?.refund).toBeNull()
  })

  it('returns null order + null refund when joins return empty', async () => {
    getSessionUserMock.mockResolvedValue({ id: 'u1', email: 'a@b.c', role: 'partner', display_name: 'X' })
    serverQueue = [
      { data: SALE_ROW, error: null },
      { data: { timezone: 'UTC' }, error: null },
      { data: null, error: null }, // order not found
    ]
    const fn = await load()
    const out = await fn(42)
    expect(out?.entry.id).toBe(42)
    expect(out?.order).toBeNull()
  })
})

describe('getPartnerLedgerEntry — timezone passthrough', () => {
  it("falls back to 'UTC' when profile row is missing", async () => {
    getSessionUserMock.mockResolvedValue({ id: 'u1', email: 'a@b.c', role: 'partner', display_name: 'X' })
    serverQueue = [
      { data: SALE_ROW, error: null },
      { data: null, error: null }, // profile missing
      { data: ORDER_ROW, error: null },
    ]
    const fn = await load()
    const out = await fn(42)
    expect(out?.timezone).toBe('UTC')
  })

  it("falls back to 'UTC' when profile.timezone is null", async () => {
    getSessionUserMock.mockResolvedValue({ id: 'u1', email: 'a@b.c', role: 'partner', display_name: 'X' })
    serverQueue = [
      { data: SALE_ROW, error: null },
      { data: { timezone: null }, error: null },
      { data: ORDER_ROW, error: null },
    ]
    const fn = await load()
    const out = await fn(42)
    expect(out?.timezone).toBe('UTC')
  })

  it("falls back to 'UTC' when profile.timezone is empty string", async () => {
    getSessionUserMock.mockResolvedValue({ id: 'u1', email: 'a@b.c', role: 'partner', display_name: 'X' })
    serverQueue = [
      { data: SALE_ROW, error: null },
      { data: { timezone: '' }, error: null },
      { data: ORDER_ROW, error: null },
    ]
    const fn = await load()
    const out = await fn(42)
    expect(out?.timezone).toBe('UTC')
  })

  it('passes through IANA timezone string', async () => {
    getSessionUserMock.mockResolvedValue({ id: 'u1', email: 'a@b.c', role: 'partner', display_name: 'X' })
    serverQueue = [
      { data: SALE_ROW, error: null },
      { data: { timezone: 'Asia/Tokyo' }, error: null },
      { data: ORDER_ROW, error: null },
    ]
    const fn = await load()
    const out = await fn(42)
    expect(out?.timezone).toBe('Asia/Tokyo')
  })
})

describe('getPartnerLedgerEntry — data-consistency warning', () => {
  it('warns when kind=refund but refund_id is null', async () => {
    getSessionUserMock.mockResolvedValue({ id: 'u1', email: 'a@b.c', role: 'partner', display_name: 'X' })
    serverQueue = [
      {
        data: {
          ...SALE_ROW,
          kind: 'refund',
          amount_cents: -4500,
          refund_id: null,
          order_id: null,
        },
        error: null,
      },
      { data: { timezone: 'UTC' }, error: null },
    ]
    const fn = await load()
    const out = await fn(42)
    expect(out?.entry.kind).toBe('refund')
    expect(out?.entry.refund_id).toBeNull()
    expect(logCalls.some((c) => c.payload?.code === 'refund_row_missing_refund_id')).toBe(true)
  })

  it('does NOT warn for kind=order_sale with refund_id=null (normal)', async () => {
    getSessionUserMock.mockResolvedValue({ id: 'u1', email: 'a@b.c', role: 'partner', display_name: 'X' })
    serverQueue = [
      { data: SALE_ROW, error: null }, // refund_id: null, kind: order_sale
      { data: { timezone: 'UTC' }, error: null },
      { data: ORDER_ROW, error: null },
    ]
    const fn = await load()
    const out = await fn(42)
    expect(out?.entry.kind).toBe('order_sale')
    expect(logCalls.some((c) => c.payload?.code === 'refund_row_missing_refund_id')).toBe(false)
  })
})

describe('getPartnerLedgerEntry — PII safety in logs', () => {
  it('does not log raw partner_id / user_id / email', async () => {
    getSessionUserMock.mockResolvedValue({ id: 'u1', email: 'a@b.c', role: 'partner', display_name: 'X' })
    serverQueue = [
      { data: null, error: { message: 'connection refused', code: '08006' } },
      { data: { timezone: 'UTC' }, error: null },
    ]
    const fn = await load()
    await fn(42)
    for (const call of logCalls) {
      const payload = JSON.stringify(call.payload)
      expect(payload).not.toContain('u1')
      expect(payload).not.toContain('a@b.c')
      expect(payload).not.toContain('user_id')
    }
  })
})
