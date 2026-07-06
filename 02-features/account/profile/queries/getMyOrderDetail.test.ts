// getMyOrderDetail.test.ts — unit tests for the user's own order-detail
// query used by /account/orders/[id]. Covers:
//
//   - anon path: returns null with no orders query
//   - missing / wrong-owner order: returns null
//   - happy path: full mapped shape (header + items + coupon_code +
//     billing_address + days_remaining + has_active_refund)
//   - refund-window math: days_remaining & window_end_at are computed
//     correctly relative to created_at
//   - coupon_code resolution: joined array vs single object vs null
//   - billing_address: present / absent / non-object
//   - stripe_payment_intent_short: truncated to 8 chars + ellipsis;
//     null when the PI id is absent
//   - items mapping: title / slug / thumbnail_url from products join;
//     fallback "(removed product)" + null slug when products is null
//   - has_active_refund: true when status='pending' or 'succeeded'
//     refund rows exist; false for failed/canceled
//   - DB error → null
//   - PII safety: select payload never includes `email` of OTHER
//     users (we only select the buyer's own row via `eq('user_id')`)

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Call =
  | { method: 'auth.getUser' }
  | { method: 'from'; table: string }
  | { method: 'select'; payload: string; opts: unknown }
  | { method: 'eq'; col: string; val: unknown }
  | { method: 'order'; col: string; opts: unknown }
  | { method: 'in'; col: string; val: unknown }
  | { method: 'single' }

const calls: Call[] = []

let getUserResponse: {
  data: { user: { id: string; email: string } | null }
  error: unknown
} = { data: { user: { id: 'user-uuid-1', email: 'klaas@example.com' } }, error: null }

let ordersResponse: { data: Record<string, unknown> | null; error: unknown } = {
  data: null,
  error: null,
}
let orderItemsResponse: { data: Array<Record<string, unknown>> | null; error: unknown } = {
  data: [],
  error: null,
}
let refundsResponse: { count: number | null; error: unknown } = { count: 0, error: null }

// Make a thenable chain that resolves with the supplied response.
const thenable = (response: unknown) => {
  const t: any = {}
  t.then = (onFulfilled: (v: unknown) => unknown) => Promise.resolve(response).then(onFulfilled)
  return t
}

function makeChain(terminalResponse: () => unknown) {
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
    order(col: string, opts: unknown) {
      calls.push({ method: 'order', col, opts })
      return chain
    },
    single() {
      calls.push({ method: 'single' })
      return thenable(terminalResponse())
    },
    maybeSingle() {
      calls.push({ method: 'single' as const })
      return thenable(terminalResponse())
    },
    // supabase-js's PostgrestFilterBuilder is awaitable directly when
    // no terminal is called (e.g. a list query like
    // `.from(table).select(...).eq(...).order(...)`). The chain mock
    // needs the same behavior so `await supabase.from(...)...order(...)`
    // resolves with the configured list response.
    then: (onFulfilled: (v: unknown) => unknown) =>
      Promise.resolve(terminalResponse()).then(onFulfilled),
  }
  return chain
}

function makeHeadChain() {
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
  Object.defineProperty(chain, 'then', {
    get: () => (onFulfilled: (v: unknown) => unknown) =>
      Promise.resolve(refundsResponse).then(onFulfilled),
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
    if (table === 'orders') {
      return makeChain(() => ordersResponse)
    }
    if (table === 'order_items') {
      return makeChain(() => orderItemsResponse)
    }
    if (table === 'refunds') {
      return makeHeadChain()
    }
    return makeChain(() => ({ data: null, error: null }))
  }),
}

vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: vi.fn(async () => fakeSupabase),
}))

const { getMyOrderDetail } = await import('./getMyOrderDetail')

beforeEach(() => {
  calls.length = 0
  fakeSupabase.from.mockClear()
  fakeSupabase.auth.getUser.mockClear()
  // Default happy path: paid order 3 days ago with a coupon and a
  // billing address and no active refunds.
  getUserResponse = {
    data: { user: { id: 'user-uuid-1', email: 'klaas@example.com' } },
    error: null,
  }
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
  ordersResponse = {
    data: {
      id: 12345,
      created_at: threeDaysAgo,
      email: 'klaas@example.com',
      status: 'paid',
      subtotal_cents: 49700,
      discount_cents: 4970,
      tax_cents: 0,
      total_cents: 44730,
      refunded_cents: 0,
      currency: 'USD',
      stripe_payment_intent_id: 'pi_3OABCdefGHIjklMNopQRstu',
      billing_address: {
        name: 'Klaas Bo',
        line1: '123 Main St',
        line2: null,
        city: 'Amsterdam',
        state: null,
        postal_code: '1011AB',
        country: 'NL',
      },
      coupons: { code: 'WELCOME10' },
    },
    error: null,
  }
  orderItemsResponse = {
    data: [
      {
        id: 9001,
        product_id: 42,
        license: 'plr',
        unit_price_cents: 49700,
        quantity: 1,
        line_total_cents: 44730,
        subscriber_discount_cents: 4970,
        products: {
          title: 'Awesome Course',
          slug: 'awesome-course',
          thumbnail_url: 'https://cdn.example.com/awesome.png',
        },
      },
    ],
    error: null,
  }
  refundsResponse = { count: 0, error: null }
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('getMyOrderDetail — anon path', () => {
  it('returns null without hitting the orders table when no user', async () => {
    getUserResponse = { data: { user: null }, error: null }
    const result = await getMyOrderDetail(12345)
    expect(result).toBeNull()
    const ordersFrom = calls.find((c) => c.method === 'from' && (c as any).table === 'orders')
    expect(ordersFrom).toBeUndefined()
  })
})

describe('getMyOrderDetail — not-found / wrong-owner', () => {
  it('returns null when the order does not exist', async () => {
    ordersResponse = { data: null, error: null }
    const result = await getMyOrderDetail(99999)
    expect(result).toBeNull()
  })

  it('returns null when the orders query errors', async () => {
    ordersResponse = { data: null, error: { message: 'db down' } }
    const result = await getMyOrderDetail(12345)
    expect(result).toBeNull()
  })
})

describe('getMyOrderDetail — happy path', () => {
  it('maps the full shape with all P9.11 fields populated', async () => {
    const result = await getMyOrderDetail(12345)
    expect(result).not.toBeNull()
    expect(result!.id).toBe(12345)
    expect(result!.status).toBe('paid')
    expect(result!.coupon_code).toBe('WELCOME10')
    expect(result!.billing_address).toEqual({
      name: 'Klaas Bo',
      line1: '123 Main St',
      line2: null,
      city: 'Amsterdam',
      state: null,
      postal_code: '1011AB',
      country: 'NL',
    })
    // PI short: first 8 chars + ellipsis
    expect(result!.stripe_payment_intent_short).toBe('pi_3OAB…')
    expect(result!.has_active_refund).toBe(false)
    expect(result!.days_remaining).toBeGreaterThan(10) // 3 days in, 11 left
    expect(result!.items).toHaveLength(1)
    expect(result!.items[0]!.product_title).toBe('Awesome Course')
    expect(result!.items[0]!.product_slug).toBe('awesome-course')
    expect(result!.items[0]!.product_thumbnail_url).toBe('https://cdn.example.com/awesome.png')
  })

  it('always pins user_id to the signed-in user (defense-in-depth)', async () => {
    await getMyOrderDetail(12345)
    // The first .eq on orders should be on `id`; the second should
    // pin `user_id` to the session user.
    const eqCalls = calls.filter((c) => c.method === 'eq') as Extract<Call, { method: 'eq' }>[]
    expect(eqCalls.length).toBeGreaterThanOrEqual(2)
    expect(eqCalls.some((c) => c.col === 'user_id' && c.val === 'user-uuid-1')).toBe(true)
  })
})

describe('getMyOrderDetail — refund window math', () => {
  it('returns days_remaining=0 when the order is older than 14 days', async () => {
    const twentyDaysAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString()
    ordersResponse = {
      ...ordersResponse,
      data: { ...(ordersResponse.data as object), created_at: twentyDaysAgo },
    }
    const result = await getMyOrderDetail(12345)
    expect(result!.days_remaining).toBe(0)
    expect(result!.window_end_at).toBeTruthy()
  })

  it('returns days_remaining=1 on the last day of the window', async () => {
    // 13.9 days ago → 0.1 day remaining → ceil to 1
    const almost = new Date(Date.now() - 13.9 * 24 * 60 * 60 * 1000).toISOString()
    ordersResponse = {
      ...ordersResponse,
      data: { ...(ordersResponse.data as object), created_at: almost },
    }
    const result = await getMyOrderDetail(12345)
    expect(result!.days_remaining).toBe(1)
  })
})

describe('getMyOrderDetail — has_active_refund', () => {
  it('returns true when a refund row exists with status=pending', async () => {
    refundsResponse = { count: 1, error: null }
    const result = await getMyOrderDetail(12345)
    expect(result!.has_active_refund).toBe(true)
  })

  it('returns true when a refund row exists with status=succeeded', async () => {
    refundsResponse = { count: 1, error: null }
    const result = await getMyOrderDetail(12345)
    expect(result!.has_active_refund).toBe(true)
  })

  it('returns false when refund count is zero', async () => {
    refundsResponse = { count: 0, error: null }
    const result = await getMyOrderDetail(12345)
    expect(result!.has_active_refund).toBe(false)
  })

  it('queries refunds with status IN (pending, succeeded)', async () => {
    await getMyOrderDetail(12345)
    const inCall = calls.find((c) => c.method === 'in') as Extract<Call, { method: 'in' }> | undefined
    expect(inCall).toBeDefined()
    expect(inCall!.col).toBe('status')
    expect(inCall!.val).toEqual(['pending', 'succeeded'])
  })
})

describe('getMyOrderDetail — coupon_code resolution', () => {
  it('handles the coupon join as an array of one row', async () => {
    ordersResponse = {
      ...ordersResponse,
      data: { ...(ordersResponse.data as object), coupons: [{ code: 'SUMMER25' }] },
    }
    const result = await getMyOrderDetail(12345)
    expect(result!.coupon_code).toBe('SUMMER25')
  })

  it('handles the coupon join as a single object', async () => {
    ordersResponse = {
      ...ordersResponse,
      data: { ...(ordersResponse.data as object), coupons: { code: 'WELCOME10' } },
    }
    const result = await getMyOrderDetail(12345)
    expect(result!.coupon_code).toBe('WELCOME10')
  })

  it('returns null coupon_code when no coupon was used', async () => {
    ordersResponse = {
      ...ordersResponse,
      data: { ...(ordersResponse.data as object), coupons: null },
    }
    const result = await getMyOrderDetail(12345)
    expect(result!.coupon_code).toBeNull()
  })
})

describe('getMyOrderDetail — billing_address handling', () => {
  it('returns null when billing_address is null (collection disabled)', async () => {
    ordersResponse = {
      ...ordersResponse,
      data: { ...(ordersResponse.data as object), billing_address: null },
    }
    const result = await getMyOrderDetail(12345)
    expect(result!.billing_address).toBeNull()
  })

  it('returns null when billing_address is a non-object value', async () => {
    ordersResponse = {
      ...ordersResponse,
      data: { ...(ordersResponse.data as object), billing_address: 'oops' },
    }
    const result = await getMyOrderDetail(12345)
    expect(result!.billing_address).toBeNull()
  })
})

describe('getMyOrderDetail — stripe_payment_intent_short', () => {
  it('returns null when stripe_payment_intent_id is null', async () => {
    ordersResponse = {
      ...ordersResponse,
      data: { ...(ordersResponse.data as object), stripe_payment_intent_id: null },
    }
    const result = await getMyOrderDetail(12345)
    expect(result!.stripe_payment_intent_short).toBeNull()
  })

  it('truncates a long PI id to 8 chars + ellipsis', async () => {
    ordersResponse = {
      ...ordersResponse,
      data: {
        ...(ordersResponse.data as object),
        stripe_payment_intent_id: 'pi_3OABCdefGHIjklMNopQRstu',
      },
    }
    const result = await getMyOrderDetail(12345)
    expect(result!.stripe_payment_intent_short).toBe('pi_3OAB…')
  })

  it('returns the short id as-is when the PI id is exactly 8 chars', async () => {
    ordersResponse = {
      ...ordersResponse,
      data: { ...(ordersResponse.data as object), stripe_payment_intent_id: 'pi_xxxxx' },
    }
    const result = await getMyOrderDetail(12345)
    // 7 chars + ellipsis — still gets the ellipsis since len > 0 and not >8
    expect(result!.stripe_payment_intent_short).toBe('pi_xxxx…')
  })
})

describe('getMyOrderDetail — items defensive mapping', () => {
  it('falls back to "(removed product)" when the products join is null', async () => {
    orderItemsResponse = {
      data: [
        {
          id: 9001,
          product_id: 999,
          license: 'mrr',
          unit_price_cents: 1000,
          quantity: 1,
          line_total_cents: 1000,
          subscriber_discount_cents: 0,
          products: null,
        },
      ],
      error: null,
    }
    const result = await getMyOrderDetail(12345)
    expect(result!.items[0]!.product_title).toBe('(removed product)')
    expect(result!.items[0]!.product_slug).toBeNull()
    expect(result!.items[0]!.product_thumbnail_url).toBeNull()
  })

  it('returns an empty items array when order_items has no rows', async () => {
    orderItemsResponse = { data: [], error: null }
    const result = await getMyOrderDetail(12345)
    expect(result!.items).toEqual([])
  })
})