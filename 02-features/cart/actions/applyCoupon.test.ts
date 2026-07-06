// applyCouponAction.test.ts — unit tests for the applyCouponAction server
// action.
//
// Covers (mirrors the spec's 4 coupon shapes from PHASES.md P4.5):
//   - Input validation (Zod rejects malformed input before any DB call).
//   - Auth branch — happy path (global coupon attaches to all eligible
//     lines); partner-restricted (only attaches to lines whose product
//     belongs to the partner); product-restricted (only attaches to the
//     matching cart line); subscriber-only (rejects non-subscribers,
//     accepts active subs); error paths (not found, not yet active,
//     expired, fully redeemed); empty cart error.
//   - Anon branch — rejected (action requires auth per spec).
//   - Telemetry — revalidatePath called for both /cart and /checkout on
//     success; the returned `discount_label` matches the bps shape.
//
// Strategy: vi.mock `next/cache` (so revalidatePath is observable but
// harmless), `next/headers` (cookies — anon path needs it), the
// Supabase client (chainable fake with rpcQueue for `has_active_subscription`
// + the coupon lookup + the cart_items fetch + the cart_items update), the
// auth guard (controllable user), and the pino logger (no-op).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ----- Mock next/cache ----------------------------------------------
const revalidateCalls: Array<{ path: string; kind: string | undefined }> = []
vi.mock('next/cache', () => ({
  revalidatePath: (path: string, kind?: string) => {
    revalidateCalls.push({ path, kind })
  },
}))

// ----- Mock next/headers cookies() ---------------------------------
const cookieStore = new Map<string, string>()
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => {
      const v = cookieStore.get(name)
      return v ? { name, value: v } : undefined
    },
    set: (name: string, value: string) => {
      cookieStore.set(name, value)
    },
    delete: (name: string) => {
      cookieStore.delete(name)
    },
  })),
}))

// ----- Mock getServerSupabase with a chainable fake ---------------
type Call =
  | { method: 'select'; payload: unknown }
  | { method: 'eq'; col: string; val: unknown }
  | { method: 'in'; col: string; vals: unknown[] }
  | { method: 'not'; col: string; op: string; val: unknown }
  | { method: 'maybeSingle' }
  | { method: 'single' }
  | { method: 'update'; payload: unknown }
  | { method: 'delete' }
  | { method: 'insert'; payload: unknown }

type EqCall = Extract<Call, { method: 'eq' }>
type InCall = Extract<Call, { method: 'in' }>
type NotCall = Extract<Call, { method: 'not' }>
type UpdateCall = Extract<Call, { method: 'update' }>

const calls: Call[] = []
let mockUser: { id: string } | null = null
// Sequence of terminal responses — one per awaited terminal call
// (single / maybeSingle / then). The fake pops in order.
let terminalQueue: Array<{ data: unknown; error: unknown }> = []
let rpcQueue: Array<{ data: unknown; error: unknown }> = []

function makeChain() {
  const chain: any = {
    select(payload: unknown) {
      calls.push({ method: 'select', payload })
      return chain
    },
    eq(col: string, val: unknown) {
      calls.push({ method: 'eq', col, val })
      return chain
    },
    in(col: string, vals: unknown[]) {
      calls.push({ method: 'in', col, vals })
      return chain
    },
    not(col: string, op: string, val: unknown) {
      calls.push({ method: 'not', col, op, val })
      return chain
    },
    insert(payload: unknown) {
      calls.push({ method: 'insert', payload })
      return chain
    },
    update(payload: unknown) {
      calls.push({ method: 'update', payload })
      return chain
    },
    delete() {
      calls.push({ method: 'delete' })
      return chain
    },
    maybeSingle: vi.fn(async () => {
      calls.push({ method: 'maybeSingle' })
      const next = terminalQueue.shift() ?? { data: null, error: null }
      return next
    }),
    single: vi.fn(async () => {
      calls.push({ method: 'single' })
      const next = terminalQueue.shift() ?? { data: null, error: null }
      return next
    }),
    then(resolve: (v: unknown) => unknown) {
      // The bare `await supabase.from(...).select(...)` returns a thenable
      // via the chain — the cart_items read path uses this. Pop the next
      // terminal response and return it.
      const next = terminalQueue.shift() ?? { data: [], error: null }
      return Promise.resolve(next).then(resolve)
    },
  }
  return chain
}

const fakeSupabase = {
  from: vi.fn(() => makeChain()),
  // `supabase.rpc('name', args)` is a TOP-LEVEL call (not on a from() chain).
  // The apply action uses it for `has_active_subscription(uuid)` on the
  // subscriber-only gate. The fake pops the rpc queue in order.
  rpc: vi.fn((name: string, _args: unknown) => {
    const next = rpcQueue.shift() ?? { data: false, error: null }
    return Promise.resolve(next)
  }),
}

vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: vi.fn(() => fakeSupabase),
}))

vi.mock('@foundations/auth/guards', () => ({
  getSessionUser: vi.fn(async () => mockUser),
}))

vi.mock('@foundations/log/pino', () => ({
  loggerFor: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

// ----- Import after mocks -----------------------------------------
const { applyCouponAction } = await import('./applyCoupon')

beforeEach(() => {
  calls.length = 0
  terminalQueue = []
  rpcQueue = []
  cookieStore.clear()
  revalidateCalls.length = 0
  mockUser = null
  fakeSupabase.from.mockClear()
})

afterEach(() => {
  vi.clearAllMocks()
})

// ===================================================================
//  Input validation
// ===================================================================

describe('applyCouponAction — input validation', () => {
  it('rejects when code is missing', async () => {
    const res = await applyCouponAction({})
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/code/i)
    expect(fakeSupabase.from).not.toHaveBeenCalled()
  })

  it('rejects when code is too short', async () => {
    const res = await applyCouponAction({ code: 'A' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/characters/i)
    expect(fakeSupabase.from).not.toHaveBeenCalled()
  })

  it('rejects when code contains invalid characters', async () => {
    const res = await applyCouponAction({ code: 'BAD CODE!' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/letters|digits/i)
    expect(fakeSupabase.from).not.toHaveBeenCalled()
  })

  it('rejects when code is too long', async () => {
    const res = await applyCouponAction({ code: 'A'.repeat(60) })
    expect(res.ok).toBe(false)
    expect(fakeSupabase.from).not.toHaveBeenCalled()
  })

  it('uppercases the code before lookup', async () => {
    mockUser = { id: 'user-1' }
    terminalQueue.push({ data: null, error: null }) // coupon not found

    await applyCouponAction({ code: 'winter20' })
    // The coupon select filter should be against the uppercased code.
    const eqCall = calls.find((c): c is EqCall => c.method === 'eq' && c.col === 'code')
    expect(eqCall?.val).toBe('WINTER20')
  })
})

// ===================================================================
//  Auth gating
// ===================================================================

describe('applyCouponAction — auth gating', () => {
  it('rejects anonymous users (coupons require auth)', async () => {
    mockUser = null
    const res = await applyCouponAction({ code: 'WINTER20' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/sign in/i)
    expect(fakeSupabase.from).not.toHaveBeenCalled()
  })
})

// ===================================================================
//  Coupon lookup — error paths
// ===================================================================

describe('applyCouponAction — coupon lookup', () => {
  it('returns "not found" when the code does not exist', async () => {
    mockUser = { id: 'user-1' }
    terminalQueue.push({ data: null, error: null })

    const res = await applyCouponAction({ code: 'MISSING' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/not found/i)
  })

  it('returns "not found" when the DB returns an error', async () => {
    mockUser = { id: 'user-1' }
    terminalQueue.push({ data: null, error: { message: 'db down' } })

    const res = await applyCouponAction({ code: 'WINTER20' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/not found/i)
  })

  it('returns "not yet active" when the coupon is in the future', async () => {
    mockUser = { id: 'user-1' }
    terminalQueue.push({
      data: {
        id: 1,
        code: 'WINTER20',
        discount_bps: 2000,
        partner_id: null,
        product_id: null,
        subscriber_only: false,
        starts_at: '2099-01-01T00:00:00Z',
        ends_at: null,
        max_redemptions: null,
        redemptions_count: 0,
        is_active: true,
      },
      error: null,
    })

    const res = await applyCouponAction({ code: 'WINTER20' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/not active yet/i)
  })

  it('returns "expired" when the coupon is past its ends_at', async () => {
    mockUser = { id: 'user-1' }
    terminalQueue.push({
      data: {
        id: 1,
        code: 'OLD10',
        discount_bps: 1000,
        partner_id: null,
        product_id: null,
        subscriber_only: false,
        starts_at: '2020-01-01T00:00:00Z',
        ends_at: '2020-12-31T23:59:59Z',
        max_redemptions: null,
        redemptions_count: 0,
        is_active: true,
      },
      error: null,
    })

    const res = await applyCouponAction({ code: 'OLD10' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/expired/i)
  })

  it('returns "fully redeemed" when max_redemptions is reached', async () => {
    mockUser = { id: 'user-1' }
    terminalQueue.push({
      data: {
        id: 1,
        code: 'CAPPED',
        discount_bps: 1500,
        partner_id: null,
        product_id: null,
        subscriber_only: false,
        starts_at: null,
        ends_at: null,
        max_redemptions: 5,
        redemptions_count: 5,
        is_active: true,
      },
      error: null,
    })

    const res = await applyCouponAction({ code: 'CAPPED' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/fully redeemed/i)
  })
})

// ===================================================================
//  Subscriber-only coupons
// ===================================================================

describe('applyCouponAction — subscriber-only gate', () => {
  const subscriberOnlyCoupon = {
    id: 99,
    code: 'SUBSONLY',
    discount_bps: 2500,
    partner_id: null,
    product_id: null,
    subscriber_only: true,
    starts_at: null,
    ends_at: null,
    max_redemptions: null,
    redemptions_count: 0,
    is_active: true,
  }

  const eligibleCart = [
    { id: 1, product: { id: 100, partner_id: 50 } },
  ]

  it('rejects when the user has no active subscription', async () => {
    mockUser = { id: 'user-1' }
    terminalQueue.push({ data: subscriberOnlyCoupon, error: null }) // coupon lookup
    rpcQueue.push({ data: false, error: null }) // has_active_subscription → false

    const res = await applyCouponAction({ code: 'SUBSONLY' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/subscribers only/i)
  })

  it('attaches to the eligible cart when the user has an active subscription', async () => {
    mockUser = { id: 'user-1' }
    terminalQueue.push({ data: subscriberOnlyCoupon, error: null }) // coupon lookup
    rpcQueue.push({ data: true, error: null }) // has_active_subscription → true
    terminalQueue.push({ data: eligibleCart, error: null }) // cart_items read
    terminalQueue.push({ data: null, error: null }) // cart_items update

    const res = await applyCouponAction({ code: 'SUBSONLY' })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.coupon_id).toBe(99)
      expect(res.discount_label).toBe('25% off')
      expect(res.applied_to_lines).toBe(1)
    }
  })
})

// ===================================================================
//  Partner-restricted coupons
// ===================================================================

describe('applyCouponAction — partner-restricted', () => {
  const partnerCoupon = {
    id: 50,
    code: 'PARTNER10',
    discount_bps: 1000,
    partner_id: 7,
    product_id: null,
    subscriber_only: false,
    starts_at: null,
    ends_at: null,
    max_redemptions: null,
    redemptions_count: 0,
    is_active: true,
  }

  it('rejects when the cart has no eligible lines for the partner', async () => {
    mockUser = { id: 'user-1' }
    terminalQueue.push({ data: partnerCoupon, error: null })
    terminalQueue.push({
      data: [
        // product belongs to partner 99, NOT partner 7
        { id: 1, product: { id: 100, partner_id: 99 } },
      ],
      error: null,
    })

    const res = await applyCouponAction({ code: 'PARTNER10' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/does not apply/i)
  })

  it('attaches only to the lines whose product belongs to the partner', async () => {
    mockUser = { id: 'user-1' }
    terminalQueue.push({ data: partnerCoupon, error: null })
    terminalQueue.push({
      data: [
        { id: 1, product: { id: 100, partner_id: 99 } }, // wrong partner
        { id: 2, product: { id: 101, partner_id: 7 } }, // right partner
        { id: 3, product: { id: 102, partner_id: 7 } }, // right partner
      ],
      error: null,
    })
    terminalQueue.push({ data: null, error: null }) // update

    const res = await applyCouponAction({ code: 'PARTNER10' })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.applied_to_lines).toBe(2)

    // The update should have used `.in('id', [2, 3])`.
    const inCall = calls.find((c): c is InCall => c.method === 'in' && c.col === 'id')
    expect(inCall?.vals).toEqual([2, 3])
  })
})

// ===================================================================
//  Product-restricted coupons
// ===================================================================

describe('applyCouponAction — product-restricted', () => {
  const productCoupon = {
    id: 75,
    code: 'PRODUCT50',
    discount_bps: 5000,
    partner_id: null,
    product_id: 999,
    subscriber_only: false,
    starts_at: null,
    ends_at: null,
    max_redemptions: null,
    redemptions_count: 0,
    is_active: true,
  }

  it('rejects when the cart has no matching product', async () => {
    mockUser = { id: 'user-1' }
    terminalQueue.push({ data: productCoupon, error: null })
    terminalQueue.push({
      data: [{ id: 1, product: { id: 100, partner_id: 1 } }],
      error: null,
    })

    const res = await applyCouponAction({ code: 'PRODUCT50' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/different product/i)
  })

  it('attaches only to the matching product line', async () => {
    mockUser = { id: 'user-1' }
    terminalQueue.push({ data: productCoupon, error: null })
    terminalQueue.push({
      data: [
        { id: 1, product: { id: 100, partner_id: 1 } },
        { id: 2, product: { id: 999, partner_id: 1 } }, // matching
      ],
      error: null,
    })
    terminalQueue.push({ data: null, error: null })

    const res = await applyCouponAction({ code: 'PRODUCT50' })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.applied_to_lines).toBe(1)

    const inCall = calls.find((c): c is InCall => c.method === 'in' && c.col === 'id')
    expect(inCall?.vals).toEqual([2])
  })
})

// ===================================================================
//  Global coupon (no restrictions) — happy path
// ===================================================================

describe('applyCouponAction — global coupon', () => {
  const globalCoupon = {
    id: 200,
    code: 'WINTER20',
    discount_bps: 2000,
    partner_id: null,
    product_id: null,
    subscriber_only: false,
    starts_at: null,
    ends_at: null,
    max_redemptions: null,
    redemptions_count: 0,
    is_active: true,
  }

  it('attaches to every active cart line and revalidates /cart + /checkout', async () => {
    mockUser = { id: 'user-1' }
    terminalQueue.push({ data: globalCoupon, error: null })
    terminalQueue.push({
      data: [
        { id: 1, product: { id: 100, partner_id: 1 } },
        { id: 2, product: { id: 101, partner_id: 2 } },
      ],
      error: null,
    })
    terminalQueue.push({ data: null, error: null })

    const res = await applyCouponAction({ code: 'WINTER20' })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.coupon_id).toBe(200)
      expect(res.discount_label).toBe('20% off')
      expect(res.applied_to_lines).toBe(2)
    }
    expect(revalidateCalls.some((c) => c.path === '/cart')).toBe(true)
    expect(revalidateCalls.some((c) => c.path === '/checkout')).toBe(true)
  })

  it('formats the discount label with two decimals when bps is not whole-percent', async () => {
    mockUser = { id: 'user-1' }
    terminalQueue.push({
      data: { ...globalCoupon, code: 'WINTER12_5', discount_bps: 1250 },
      error: null,
    })
    terminalQueue.push({
      data: [{ id: 1, product: { id: 100, partner_id: 1 } }],
      error: null,
    })
    terminalQueue.push({ data: null, error: null })

    const res = await applyCouponAction({ code: 'WINTER12_5' })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.discount_label).toBe('12.50% off')
  })

  it('returns an error when the cart is empty', async () => {
    mockUser = { id: 'user-1' }
    terminalQueue.push({ data: globalCoupon, error: null })
    terminalQueue.push({ data: [], error: null })

    const res = await applyCouponAction({ code: 'WINTER20' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/empty/i)
  })

  it('returns a typed error when the cart_items update fails', async () => {
    mockUser = { id: 'user-1' }
    // Queue order: [0] coupon lookup OK, [1] cart_items read OK,
    // [2] cart_items update fails.
    terminalQueue.push({ data: globalCoupon, error: null })
    terminalQueue.push({
      data: [{ id: 1, product: { id: 100, partner_id: 1 } }],
      error: null,
    })
    terminalQueue.push({
      data: null,
      error: { code: '42501', message: 'rls violation' },
    })

    const res = await applyCouponAction({ code: 'WINTER20' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/try again/i)
  })
})

// ===================================================================
//  Revalidation on success
// ===================================================================

describe('applyCouponAction — revalidation', () => {
  const globalCoupon = {
    id: 200,
    code: 'WINTER20',
    discount_bps: 2000,
    partner_id: null,
    product_id: null,
    subscriber_only: false,
    starts_at: null,
    ends_at: null,
    max_redemptions: null,
    redemptions_count: 0,
    is_active: true,
  }

  it('revalidates both /cart and /checkout', async () => {
    mockUser = { id: 'user-1' }
    terminalQueue.push({ data: globalCoupon, error: null })
    terminalQueue.push({
      data: [{ id: 1, product: { id: 100, partner_id: 1 } }],
      error: null,
    })
    terminalQueue.push({ data: null, error: null })

    await applyCouponAction({ code: 'WINTER20' })

    const cartReval = revalidateCalls.filter((c) => c.path === '/cart')
    const checkoutReval = revalidateCalls.filter((c) => c.path === '/checkout')
    expect(cartReval.length).toBeGreaterThanOrEqual(1)
    expect(checkoutReval.length).toBeGreaterThanOrEqual(1)
  })

  it('does NOT revalidate when the coupon is rejected', async () => {
    mockUser = { id: 'user-1' }
    terminalQueue.push({ data: null, error: null }) // not found

    await applyCouponAction({ code: 'MISSING' })
    expect(revalidateCalls.length).toBe(0)
  })
})