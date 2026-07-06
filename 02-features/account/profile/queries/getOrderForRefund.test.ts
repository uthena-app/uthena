// getOrderForRefund.test.ts — unit tests for the server query that backs
// /account/orders/[id]/refund. Uses the chainable-fake-Supabase pattern
// from the rest of the queries test suite (getMyOrders /
// getMyOrderDetail / getRefundConfirmation).
//
// Coverage:
//   - Anon path: returns null without hitting the orders table.
//   - Ineligible orders (404-equivalent):
//       - Order does not exist (maybeSingle → null).
//       - Order exists but belongs to another user (RLS hides it;
//         the query also has an explicit `eq('user_id', user.id)`
//         defense-in-depth).
//       - Order is in a non-paid status (refunded, awaiting_payment…).
//       - Order is past the 14-day refund window.
//       - A refund row already exists with status in
//         ('pending', 'succeeded') — one refund per order.
//   - Happy path: full mapped shape (eligibility.order + items +
//     alreadyRefundedCents + remainingRefundableCents + windowEndAt +
//     daysRemaining).
//   - Defensive mapping:
//       - missing products join → "(removed product)" + null slug.
//       - missing order_items → empty items array.
//       - refunded_cents null → alreadyRefundedCents = 0 (Math.max).
//   - RLS scope: the orders select is always filtered by user_id.
//   - PII safety: orders select never pulls email / ip / user_agent /
//     billing_address / stripe_payment_intent_id.
//
// All three terminal queries (orders maybeSingle, refunds head-count,
// order_items list) live behind the same chain mock; we configure the
// per-table response via `setResponse(table, ...)`.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Call =
  | { method: 'auth.getUser' }
  | { method: 'from'; table: string }
  | { method: 'select'; payload: string; opts: unknown }
  | { method: 'eq'; col: string; val: unknown }
  | { method: 'in'; col: string; val: unknown }
  | { method: 'order'; col: string; opts: unknown }
  | { method: 'maybeSingle' }

const calls: Call[] = []

let getUserResponse: {
  data: { user: { id: string; email: string } | null }
  error: unknown
} = { data: { user: null }, error: null }

type Response = { data?: unknown | null; count?: number | null; error: unknown }
const responses = new Map<string, Response>([
  ['orders', { data: null, error: null }],
  ['order_items', { data: [], error: null }],
  ['refunds', { count: 0, error: null }],
])
function setResponse(table: string, r: Response) {
  responses.set(table, r)
}
function getResponse(table: string): Response {
  return responses.get(table) ?? { data: null, error: null }
}

// Thenable helper — vitest + esbuild works with this pattern.
const thenable = (response: unknown) => {
  const t: any = {}
  t.then = (onFulfilled: (v: unknown) => unknown) =>
    Promise.resolve(response).then(onFulfilled)
  return t
}

function makeOrdersChain(): any {
  const chain: any = {
    select(payload: string, opts: unknown) {
      calls.push({ method: 'select', payload, opts })
      return chain
    },
    eq(col: string, val: unknown) {
      calls.push({ method: 'eq', col, val })
      return chain
    },
    maybeSingle: vi.fn(async () => {
      calls.push({ method: 'maybeSingle' })
      return getResponse('orders')
    }),
  }
  return chain
}

function makeHeadChain(): any {
  const chain: any = {
    select(payload: string, opts: unknown) {
      calls.push({ method: 'select', payload, opts })
      return chain
    },
    eq(col: string, val: unknown) {
      calls.push({ method: 'eq', col, val })
      return chain
    },
    in(col: string, val: unknown) {
      calls.push({ method: 'in', col, val })
      return chain
    },
  }
  // Terminal: the production code destructures `{ count }` off the
  // awaited chain (no .single() / .maybeSingle() — the chain is
  // directly awaitable when `head: true`).
  Object.defineProperty(chain, 'then', {
    get: () => (onFulfilled: (v: unknown) => unknown) =>
      Promise.resolve(getResponse('refunds')).then(onFulfilled),
  })
  return chain
}

function makeItemsChain(): any {
  const chain: any = {
    select(payload: string, opts: unknown) {
      calls.push({ method: 'select', payload, opts })
      return chain
    },
    eq(col: string, val: unknown) {
      calls.push({ method: 'eq', col, val })
      return chain
    },
    order(col: string, opts: unknown) {
      calls.push({ method: 'order', col, opts })
      return chain
    },
  }
  Object.defineProperty(chain, 'then', {
    get: () => (onFulfilled: (v: unknown) => unknown) =>
      Promise.resolve(getResponse('order_items')).then(onFulfilled),
  })
  return chain
}

const fakeSupabase = {
  auth: {
    getUser: vi.fn(async () => {
      calls.push({ method: 'auth.getUser' })
      return getUserResponse
    }),
  },
  from: vi.fn((table: string) => {
    calls.push({ method: 'from', table })
    if (table === 'orders') return makeOrdersChain()
    if (table === 'refunds') return makeHeadChain()
    if (table === 'order_items') return makeItemsChain()
    // unknown table — should never be hit
    throw new Error(`unexpected table: ${table}`)
  }),
}

vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: vi.fn(async () => fakeSupabase),
}))

const { getOrderForRefund } = await import('./getOrderForRefund')

const THREE_DAYS_AGO = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
const TWENTY_DAYS_AGO = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString()

function paidOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 12345,
    created_at: THREE_DAYS_AGO,
    total_cents: 49700,
    currency: 'USD',
    status: 'paid',
    refunded_cents: 0,
    ...overrides,
  }
}

function twoLineItems(overrides: Record<string, unknown> = {}) {
  return [
    {
      id: 9001,
      license: 'plr',
      unit_price_cents: 49700,
      quantity: 1,
      line_total_cents: 49700,
      products: { title: 'Awesome Course', slug: 'awesome-course' },
      ...overrides,
    },
  ]
}

beforeEach(() => {
  calls.length = 0
  fakeSupabase.from.mockClear()
  fakeSupabase.auth.getUser.mockClear()
  getUserResponse = {
    data: { user: { id: 'user-uuid-1', email: 'klaas@example.com' } },
    error: null,
  }
  setResponse('orders', { data: paidOrder(), error: null })
  setResponse('order_items', { data: twoLineItems(), error: null })
  setResponse('refunds', { count: 0, error: null })
})

afterEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// anon
// ---------------------------------------------------------------------------

describe('getOrderForRefund — anon path', () => {
  it('returns null without touching the orders table when no user', async () => {
    getUserResponse = { data: { user: null }, error: null }
    const result = await getOrderForRefund(12345)
    expect(result).toBeNull()
    const ordersFrom = calls.find((c) => c.method === 'from' && (c as any).table === 'orders')
    expect(ordersFrom).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// not-found / wrong-owner / non-paid / window expired / existing refund
// ---------------------------------------------------------------------------

describe('getOrderForRefund — eligibility rejections', () => {
  it('returns null when the order does not exist', async () => {
    setResponse('orders', { data: null, error: null })
    const result = await getOrderForRefund(99999)
    expect(result).toBeNull()
  })

  it('returns null when the orders query errors', async () => {
    setResponse('orders', { data: null, error: { message: 'db down' } })
    const result = await getOrderForRefund(12345)
    expect(result).toBeNull()
  })

  it('returns null when status != "paid" (refunded)', async () => {
    setResponse('orders', { data: paidOrder({ status: 'refunded' }), error: null })
    const result = await getOrderForRefund(12345)
    expect(result).toBeNull()
  })

  it('returns null when status != "paid" (awaiting_payment)', async () => {
    setResponse('orders', {
      data: paidOrder({ status: 'awaiting_payment' }),
      error: null,
    })
    const result = await getOrderForRefund(12345)
    expect(result).toBeNull()
  })

  it('returns null when the order is past the 14-day refund window', async () => {
    setResponse('orders', { data: paidOrder({ created_at: TWENTY_DAYS_AGO }), error: null })
    const result = await getOrderForRefund(12345)
    expect(result).toBeNull()
  })

  it('returns null when a refund row already exists with status="pending"', async () => {
    setResponse('refunds', { count: 1, error: null })
    const result = await getOrderForRefund(12345)
    expect(result).toBeNull()
  })

  it('returns null when a refund row already exists with status="succeeded"', async () => {
    setResponse('refunds', { count: 1, error: null })
    const result = await getOrderForRefund(12345)
    expect(result).toBeNull()
  })

  it('ALLOWS the form when a refund row exists with status="failed" (no-op refund)', async () => {
    // Per the comment in getMyOrderDetail.ts: failed/canceled refunds
    // are no-ops; the user is still eligible to re-request. The
    // spec calls out "one refund per order" but a failed one doesn't
    // count — the action does the same check (`in ['pending',
    // 'succeeded']`). We assert the query filters accordingly.
    setResponse('refunds', { count: 0, error: null })
    const result = await getOrderForRefund(12345)
    expect(result).not.toBeNull()
    const inCall = calls.find((c) => c.method === 'in') as
      | Extract<Call, { method: 'in' }>
      | undefined
    expect(inCall).toBeDefined()
    expect(inCall!.col).toBe('status')
    expect(inCall!.val).toEqual(['pending', 'succeeded'])
  })
})

// ---------------------------------------------------------------------------
// happy path
// ---------------------------------------------------------------------------

describe('getOrderForRefund — happy path', () => {
  it('returns the full mapped shape (order + items + window + remaining)', async () => {
    const result = await getOrderForRefund(12345)
    expect(result).not.toBeNull()
    expect(result!.eligible).toBe(true)
    expect(result!.order.id).toBe(12345)
    expect(result!.order.status).toBe('paid')
    expect(result!.order.total_cents).toBe(49700)
    expect(result!.order.currency).toBe('USD')
    expect(result!.order.items).toHaveLength(1)
    expect(result!.order.items[0]!.product_title).toBe('Awesome Course')
    expect(result!.order.items[0]!.product_slug).toBe('awesome-course')
    expect(result!.alreadyRefundedCents).toBe(0)
    expect(result!.remainingRefundableCents).toBe(49700)
    expect(typeof result!.windowEndAt).toBe('string')
    // 14-day window from 3 days ago → 11 days remaining (ceil).
    expect(result!.daysRemaining).toBeGreaterThanOrEqual(10)
    expect(result!.daysRemaining).toBeLessThanOrEqual(11)
  })

  it('subtracts refunded_cents from remaining (alreadyRefundedCents surfaces separately)', async () => {
    setResponse('orders', {
      data: paidOrder({ total_cents: 49700, refunded_cents: 10000 }),
      error: null,
    })
    const result = await getOrderForRefund(12345)
    expect(result!.alreadyRefundedCents).toBe(10000)
    expect(result!.remainingRefundableCents).toBe(39700)
  })

  it('clamps remaining to 0 (Math.max) when refunded_cents >= total_cents', async () => {
    // Defensive — a tampered / corrupt row should not yield a
    // negative remaining (the form would render a partial input
    // with min=0.01 and max=negative which is nonsense).
    setResponse('orders', {
      data: paidOrder({ total_cents: 49700, refunded_cents: 60000 }),
      error: null,
    })
    const result = await getOrderForRefund(12345)
    expect(result!.alreadyRefundedCents).toBe(60000)
    expect(result!.remainingRefundableCents).toBe(0)
  })

  it('treats refunded_cents=null as 0 (defensive cast)', async () => {
    setResponse('orders', {
      data: paidOrder({ refunded_cents: null }),
      error: null,
    })
    const result = await getOrderForRefund(12345)
    expect(result!.alreadyRefundedCents).toBe(0)
    expect(result!.remainingRefundableCents).toBe(49700)
  })
})

// ---------------------------------------------------------------------------
// defensive item mapping
// ---------------------------------------------------------------------------

describe('getOrderForRefund — items defensive mapping', () => {
  it('falls back to "(removed product)" + null slug when the products join is null', async () => {
    setResponse('order_items', {
      data: [
        {
          id: 9001,
          license: 'mrr',
          unit_price_cents: 49700,
          quantity: 1,
          line_total_cents: 49700,
          products: null,
        },
      ],
      error: null,
    })
    const result = await getOrderForRefund(12345)
    expect(result!.order.items[0]!.product_title).toBe('(removed product)')
    expect(result!.order.items[0]!.product_slug).toBeNull()
  })

  it('returns an empty items array when order_items has no rows', async () => {
    setResponse('order_items', { data: [], error: null })
    const result = await getOrderForRefund(12345)
    expect(result!.order.items).toEqual([])
  })

  it('returns an empty items array when order_items is null (defensive)', async () => {
    setResponse('order_items', { data: null, error: null })
    const result = await getOrderForRefund(12345)
    expect(result!.order.items).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// RLS scope + PII safety on the select payload
// ---------------------------------------------------------------------------

describe('getOrderForRefund — RLS scope + PII safety', () => {
  it('scopes the orders select by user_id (defense in depth on top of RLS)', async () => {
    await getOrderForRefund(12345)
    const eqCalls = calls.filter((c) => c.method === 'eq') as Array<
      Extract<Call, { method: 'eq' }>
    >
    // The first eq on orders is on `id`; the second pins `user_id`
    // to the signed-in user.
    expect(eqCalls.length).toBeGreaterThanOrEqual(2)
    const userIdEq = eqCalls.find((c) => c.col === 'user_id')
    expect(userIdEq).toBeDefined()
    expect(userIdEq!.val).toBe('user-uuid-1')
  })

  it('always uses the signed-in user id (no cached auth across calls)', async () => {
    // First call as user A
    getUserResponse = {
      data: { user: { id: 'user-a', email: 'a@example.com' } },
      error: null,
    }
    await getOrderForRefund(12345)
    let eqCalls = calls.filter((c) => c.method === 'eq') as Array<
      Extract<Call, { method: 'eq' }>
    >
    expect(eqCalls.find((c) => c.col === 'user_id')?.val).toBe('user-a')

    // Switch session to user B
    calls.length = 0
    getUserResponse = {
      data: { user: { id: 'user-b', email: 'b@example.com' } },
      error: null,
    }
    await getOrderForRefund(12345)
    eqCalls = calls.filter((c) => c.method === 'eq') as Array<
      Extract<Call, { method: 'eq' }>
    >
    expect(eqCalls.find((c) => c.col === 'user_id')?.val).toBe('user-b')
  })

  it('the orders select payload is PII-safe (no email / ip / user_agent / billing_address / stripe_payment_intent_id)', async () => {
    await getOrderForRefund(12345)
    const selectCalls = calls.filter((c) => c.method === 'select') as Array<
      Extract<Call, { method: 'select' }>
    >
    // Find the orders select (the only one with `id, created_at, ...`).
    const ordersSelect = selectCalls.find((c) => c.payload.includes('created_at'))
    expect(ordersSelect).toBeDefined()
    expect(ordersSelect!.payload).not.toMatch(/\bemail\b/)
    expect(ordersSelect!.payload).not.toMatch(/\bip\b/)
    expect(ordersSelect!.payload).not.toContain('user_agent')
    expect(ordersSelect!.payload).not.toContain('billing_address')
    expect(ordersSelect!.payload).not.toContain('stripe_payment_intent_id')
  })

  it('uses { count: "exact", head: true } for the existing-refunds check', async () => {
    await getOrderForRefund(12345)
    const selectCalls = calls.filter((c) => c.method === 'select') as Array<
      Extract<Call, { method: 'select' }>
    >
    // Find the refunds head-count select (payload is just 'id').
    const refundsSelect = selectCalls.find(
      (c) => c.payload === 'id' && (c.opts as { head?: boolean })?.head === true,
    )
    expect(refundsSelect).toBeDefined()
    expect((refundsSelect!.opts as { count?: string }).count).toBe('exact')
  })

  it('order_items select never expands into PII-bearing columns', async () => {
    await getOrderForRefund(12345)
    const selectCalls = calls.filter((c) => c.method === 'select') as Array<
      Extract<Call, { method: 'select' }>
    >
    const itemsSelect = selectCalls.find((c) => c.payload.includes('products('))
    expect(itemsSelect).toBeDefined()
    // The embed pulls title + slug from products — never the full
    // product row (no PII columns like description / vendor_id /
    // metadata on products).
    expect(itemsSelect!.payload).toMatch(/products\([^)]*\)/)
    expect(itemsSelect!.payload).not.toContain('*')
    expect(itemsSelect!.payload).not.toContain('email')
    expect(itemsSelect!.payload).not.toContain('vendor_id')
    expect(itemsSelect!.payload).not.toContain('metadata')
  })
})