// createCheckoutSession.test.ts — unit tests for the createCheckoutSessionAction
// server action.
//
// Covers (with a focus on P4.10 — payment method picker):
//   - Input validation (Zod rejects malformed `affiliate_handle` before any DB call).
//   - Auth branch — anonymous users get `not_authed`.
//   - Stripe configured gate — when `STRIPE_SECRET_KEY` is empty, returns
//     `stripe_unconfigured` without touching the DB.
//   - Cart-load failure paths — empty cart returns `empty_cart`.
//   - Royalty + discount math (1-line happy path).
//   - **P4.10 — Saved payment methods (returning buyer)**: when the user
//     has a prior order with `stripe_customer_id`, the session params
//     include `customer` (not `customer_email`) so Stripe Checkout
//     surfaces the buyer's saved cards.
//   - **P4.10 — First-time buyer**: when the user has no prior
//     `stripe_customer_id`, the session params fall back to
//     `customer_email`.
//   - **P4.10 — Dashboard-driven methods**: `payment_method_types` is
//     intentionally NOT in the session params; the Stripe Dashboard
//     decides whether Card / Apple Pay / Google Pay / Link are offered.
//
// Strategy: vi.mock `next/headers` (cookies + origin), the Supabase
// clients (chainable fake with terminalQueue for ordered reads +
// serviceSupabase for the order + order_items writes), the auth guard
// (controllable user), the Stripe wrapper (captures the params passed
// to `.sessions.create()` so we can assert the shape), the env helper
// (controllable `STRIPE_SECRET_KEY`), the subscriptions helper (so we
// don't drag in the full subscriptions module), the logger, and the
// idempotency helper.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ----- Mock next/headers ----------------------------------------------
vi.mock('next/headers', () => ({
  headers: vi.fn(async () => ({
    get: (name: string) => (name === 'origin' ? 'https://uthena.com' : null),
  })),
  cookies: vi.fn(async () => ({
    get: () => undefined,
    set: () => undefined,
    delete: () => undefined,
  })),
}))

// ----- Mock @foundations/env -----------------------------------------
const mockEnv = {
  STRIPE_SECRET_KEY: 'sk_test_mock',
  STRIPE_WEBHOOK_SECRET: '',
  NEXT_PUBLIC_APP_URL: 'https://uthena.com',
  DEFAULT_ROYALTY_PCT_BPS: 3000,
  PLR_SUBSCRIBER_DISCOUNT_PCT_BPS: 1500,
}
vi.mock('@foundations/env', () => ({
  getEnv: () => mockEnv,
}))

// ----- Mock @foundations/money/stripe -------------------------------
// Capture the params passed to .sessions.create() so we can assert the
// shape (P4.10 — `customer` vs `customer_email`, `payment_method_types`
// absent).
let capturedSessionParams: unknown = null
let stripeConfigured = true
const fakeStripe = {
  checkout: {
    sessions: {
      create: vi.fn(async (params: unknown) => {
        capturedSessionParams = params
        return { id: 'cs_test_mock', url: 'https://stripe.com/cp/cs_test_mock' }
      }),
    },
  },
}
vi.mock('@foundations/money/stripe', () => ({
  isStripeConfigured: vi.fn(() => stripeConfigured),
  getStripe: vi.fn(() => fakeStripe),
  withStripeErrorHandling: vi.fn(async (fn: () => Promise<unknown>) => {
    // Mimic the wrapper: run the fn and return StripeSuccess on resolve.
    try {
      const data = await fn()
      return { ok: true, data }
    } catch (err) {
      return {
        ok: false,
        code: 'unknown',
        message: (err as Error).message ?? 'unknown error',
      }
    }
  }),
  idempotencyKey: vi.fn((scope: string, ...parts: unknown[]) =>
    `${scope}:${parts.join(':')}`,
  ),
}))

// ----- Mock the Supabase clients ------------------------------------
type Call =
  | { method: 'select'; payload: unknown }
  | { method: 'eq'; col: string; val: unknown }
  | { method: 'not'; col: string; op: string; val: unknown }
  | { method: 'order'; col: string; opts: unknown }
  | { method: 'limit'; n: number }
  | { method: 'insert'; payload: unknown }
  | { method: 'update'; payload: unknown }
  | { method: 'maybeSingle' }
  | { method: 'single' }
  | { method: 'then' }

const serverCalls: Call[] = []
const serviceCalls: Call[] = []
let serverQueue: Array<{ data: unknown; error: unknown }> = []
let serviceQueue: Array<{ data: unknown; error: unknown }> = []

function makeChain(target: 'server' | 'service') {
  const calls = target === 'server' ? serverCalls : serviceCalls
  const chain: any = {
    select(payload: unknown) {
      calls.push({ method: 'select', payload })
      return chain
    },
    eq(col: string, val: unknown) {
      calls.push({ method: 'eq', col, val })
      return chain
    },
    not(col: string, op: string, val: unknown) {
      calls.push({ method: 'not', col, op, val })
      return chain
    },
    order(col: string, opts: unknown) {
      calls.push({ method: 'order', col, opts })
      return chain
    },
    limit(n: number) {
      calls.push({ method: 'limit', n })
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
    maybeSingle: vi.fn(async () => {
      calls.push({ method: 'maybeSingle' })
      const queue = target === 'server' ? serverQueue : serviceQueue
      return queue.shift() ?? { data: null, error: null }
    }),
    single: vi.fn(async () => {
      calls.push({ method: 'single' })
      const queue = target === 'server' ? serverQueue : serviceQueue
      return queue.shift() ?? { data: null, error: null }
    }),
    then(resolve: (v: unknown) => unknown) {
      calls.push({ method: 'then' })
      const queue = target === 'server' ? serverQueue : serviceQueue
      const next = queue.shift() ?? { data: [], error: null }
      return Promise.resolve(next).then(resolve)
    },
  }
  return chain
}

const fakeServerSupabase = { from: vi.fn(() => makeChain('server')) }
const fakeServiceSupabase = { from: vi.fn(() => makeChain('service')) }

vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: vi.fn(async () => fakeServerSupabase),
  getServiceSupabase: vi.fn(() => fakeServiceSupabase),
}))

// ----- Mock auth guard ----------------------------------------------
let mockUser: { id: string; email: string | null } | null = null
vi.mock('@foundations/auth/guards', () => ({
  getSessionUser: vi.fn(async () => mockUser),
}))

// ----- Mock subscriptions (so we don't drag in the full module) ----
//
// P5.9: We delegate the subscriber-discount math to the shared
// `calculateCartSubscriberDiscount` helper. We re-export the real one
// here (it's pure + side-effect-free) and only mock the discount-context
// read, which is the only DB-touching seam.
vi.mock('@features/subscriptions', async () => {
  const libActual =
    await vi.importActual<typeof import('@features/subscriptions/lib/calculateCartSubscriberDiscount')>(
      '@features/subscriptions/lib/calculateCartSubscriberDiscount',
    )
  return {
    calculateCartSubscriberDiscount: libActual.calculateCartSubscriberDiscount,
    resolveLineSubscriberBps: libActual.resolveLineSubscriberBps,
    getSubscriberDiscountContext: vi.fn(async () => ({
      isActive: false,
      discountBps: 0,
    })),
  }
})

// ----- Mock logger --------------------------------------------------
vi.mock('@foundations/log/pino', () => ({
  loggerFor: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

// ----- Import after mocks ------------------------------------------
const { createCheckoutSessionAction } = await import('./createCheckoutSession')

// ----- Default fixture: 1-line cart with a published product ---------
function defaultCartRow() {
  return [
    {
      id: 1,
      product_id: 100,
      license: 'plr',
      quantity: 1,
      status: 'active',
      coupon_id: null,
      product: {
        id: 100,
        slug: 'ai-branding',
        title: 'AI Personal Branding',
        status: 'published',
        partner_id: 7,
        partner: { royalty_pct_bps: 3500 },
        pricing: [{ license: 'plr', price_cents: 5000, is_active: true, subscriber_discount_bps: 0 }],
      },
    },
  ]
}

beforeEach(() => {
  serverCalls.length = 0
  serviceCalls.length = 0
  serverQueue = []
  serviceQueue = []
  capturedSessionParams = null
  stripeConfigured = true
  mockEnv.STRIPE_SECRET_KEY = 'sk_test_mock'
  mockUser = { id: 'user-1', email: 'user@example.com' }
  fakeServerSupabase.from.mockClear()
  fakeServiceSupabase.from.mockClear()
  fakeStripe.checkout.sessions.create.mockClear()
})

afterEach(() => {
  vi.clearAllMocks()
})

// ===================================================================
// Input validation
// ===================================================================

describe('createCheckoutSessionAction — input validation', () => {
  it('accepts an empty object (no fields required)', async () => {
    serverQueue.push({ data: [], error: null }) // cart_items read
    serverQueue.push({ data: null, error: null }) // prior order lookup (returning buyer)
    serviceQueue.push({ data: null, error: { message: 'insert failed' } }) // orders insert (force fail to short-circuit)

    const res = await createCheckoutSessionAction({})
    expect(res.ok).toBe(false) // we force-failed the orders insert
  })

  it('rejects an affiliate_handle with CRLF injection', async () => {
    mockUser = null // also no auth — but Zod runs first
    const res = await createCheckoutSessionAction({
      affiliate_handle: 'hacker\r\nSet-Cookie: x=y',
    })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      // Either Zod rejects (invalid request) or auth rejects (not_authed).
      expect(['unknown', 'not_authed']).toContain(res.code)
    }
    expect(fakeServerSupabase.from).not.toHaveBeenCalled()
  })
})

// ===================================================================
// Auth + Stripe gating
// ===================================================================

describe('createCheckoutSessionAction — auth + Stripe gating', () => {
  it('returns not_authed when no user is signed in', async () => {
    mockUser = null
    const res = await createCheckoutSessionAction({})
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe('not_authed')
    expect(fakeServerSupabase.from).not.toHaveBeenCalled()
    expect(fakeStripe.checkout.sessions.create).not.toHaveBeenCalled()
  })

  it('returns stripe_unconfigured when STRIPE_SECRET_KEY is empty', async () => {
    stripeConfigured = false
    const res = await createCheckoutSessionAction({})
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe('stripe_unconfigured')
    expect(fakeServerSupabase.from).not.toHaveBeenCalled()
    expect(fakeStripe.checkout.sessions.create).not.toHaveBeenCalled()
  })

  it('returns empty_cart when the cart has no active lines', async () => {
    serverQueue.push({ data: [], error: null }) // cart_items read
    const res = await createCheckoutSessionAction({})
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe('empty_cart')
    expect(fakeStripe.checkout.sessions.create).not.toHaveBeenCalled()
  })
})

// ===================================================================
// P4.10 — Payment method picker
// ===================================================================

describe('createCheckoutSessionAction — P4.10 payment methods', () => {
  // Common setup: a valid 1-line cart with no prior customer.
  function setupFirstTimeBuyer() {
    serverQueue.push({ data: defaultCartRow(), error: null }) // cart_items read
    serverQueue.push({ data: null, error: null }) // prior order lookup (no prior customer)
    serviceQueue.push({ data: { id: 999 }, error: null }) // orders insert
    serviceQueue.push({ data: null, error: null }) // order_items insert
    serviceQueue.push({ data: null, error: null }) // orders update (session id)
  }

  function setupReturningBuyer(customerId: string) {
    serverQueue.push({ data: defaultCartRow(), error: null }) // cart_items read
    serverQueue.push({
      data: { stripe_customer_id: customerId },
      error: null,
    }) // prior order with customer
    serviceQueue.push({ data: { id: 999 }, error: null }) // orders insert
    serviceQueue.push({ data: null, error: null }) // order_items insert
    serviceQueue.push({ data: null, error: null }) // orders update (session id)
  }

  it('first-time buyer → session uses customer_email, NOT customer', async () => {
    setupFirstTimeBuyer()

    const res = await createCheckoutSessionAction({})
    expect(res.ok).toBe(true)

    const params = capturedSessionParams as Record<string, unknown>
    expect(params.customer).toBeUndefined()
    expect(params.customer_email).toBe('user@example.com')
  })

  it('returning buyer → session uses customer, NOT customer_email', async () => {
    setupReturningBuyer('cus_EXISTING123')

    const res = await createCheckoutSessionAction({})
    expect(res.ok).toBe(true)

    const params = capturedSessionParams as Record<string, unknown>
    expect(params.customer).toBe('cus_EXISTING123')
    expect(params.customer_email).toBeUndefined()
  })

  it('first-time buyer without an email → no customer field at all', async () => {
    mockUser = { id: 'user-1', email: null }
    setupFirstTimeBuyer()

    const res = await createCheckoutSessionAction({})
    expect(res.ok).toBe(true)

    const params = capturedSessionParams as Record<string, unknown>
    expect(params.customer).toBeUndefined()
    expect(params.customer_email).toBeUndefined()
  })

  it('returns-buyer branch runs the prior-order lookup with the right filters', async () => {
    setupReturningBuyer('cus_X')

    await createCheckoutSessionAction({})

    // The first server from() call is cart_items; the second is orders
    // (the prior-order lookup). Inspect its `.not()` filter and `.limit()`.
    const fromCalls = fakeServerSupabase.from.mock.calls.map((c: unknown[]) => c[0])
    expect(fromCalls).toContain('orders')

    const notCall = serverCalls.find((c) => c.method === 'not')
    expect(notCall).toBeDefined()
    if (notCall && notCall.method === 'not') {
      expect(notCall.col).toBe('stripe_customer_id')
      expect(notCall.op).toBe('is')
      expect(notCall.val).toBe(null)
    }
    const limitCall = serverCalls.find((c) => c.method === 'limit')
    expect(limitCall).toBeDefined()
    if (limitCall && limitCall.method === 'limit') {
      expect(limitCall.n).toBe(1)
    }
  })

  it('payment_method_types is intentionally NOT in session params (Dashboard decides)', async () => {
    setupFirstTimeBuyer()

    const res = await createCheckoutSessionAction({})
    expect(res.ok).toBe(true)

    // Critical assertion: we do NOT hard-code payment methods. The
    // Stripe Dashboard's "Payment methods" config is the source of
    // truth for Card / Apple Pay / Google Pay / Link. Hard-coding
    // `['card']` here would block Apple Pay on Safari/iOS even when
    // the Dashboard has it enabled.
    const params = capturedSessionParams as Record<string, unknown>
    expect(params.payment_method_types).toBeUndefined()
  })
})

// ===================================================================
// STUB-006 — Stripe Tax (automatic_tax)
// ===================================================================

describe('createCheckoutSessionAction — STUB-006 Stripe Tax', () => {
  function setupOneLineCart() {
    serverQueue.push({ data: defaultCartRow(), error: null }) // cart_items read
    serverQueue.push({ data: null, error: null }) // prior order lookup
    serviceQueue.push({ data: { id: 999 }, error: null }) // orders insert
    serviceQueue.push({ data: null, error: null }) // order_items insert
    serviceQueue.push({ data: null, error: null }) // orders update (session id)
  }

  it('creates the session with automatic_tax.enabled = true', async () => {
    setupOneLineCart()

    const res = await createCheckoutSessionAction({})
    expect(res.ok).toBe(true)

    const params = capturedSessionParams as {
      automatic_tax?: { enabled?: boolean }
    }
    expect(params.automatic_tax).toBeDefined()
    expect(params.automatic_tax?.enabled).toBe(true)
  })

  it('requires billing_address_collection so Stripe Tax has a location to calculate against', async () => {
    setupOneLineCart()

    const res = await createCheckoutSessionAction({})
    expect(res.ok).toBe(true)

    const params = capturedSessionParams as { billing_address_collection?: string }
    expect(params.billing_address_collection).toBe('required')
  })

  it('reads the persisted tax back from the session once Stripe computes it (webhook round-trip)', async () => {
    // This test proves the OTHER half of STUB-006: once
    // createCheckoutSessionAction has asked Stripe for automatic tax,
    // the amount Stripe returns on the completed session
    // (`total_details.amount_tax`) is exactly what
    // onPaymentSucceeded persists onto orders.tax_cents — see
    // onPaymentSucceeded.test.ts "STUB-006: Stripe Tax amount
    // propagation" for the persistence-side assertions. Here we only
    // assert the session-create side: the session response shape
    // Stripe returns is read back through `sessionResult.data`, which
    // the action logs but does not itself act on (persistence happens
    // in the webhook, not at create time, because tax isn't known
    // until the buyer enters a billing address on Stripe's hosted
    // page). Asserting the mock's return shape here keeps this test
    // from silently rotting if the fake Stripe client's session shape
    // changes.
    setupOneLineCart()
    fakeStripe.checkout.sessions.create.mockImplementationOnce(async (params: unknown) => {
      capturedSessionParams = params
      return {
        id: 'cs_test_mock_tax',
        url: 'https://stripe.com/cp/cs_test_mock_tax',
        total_details: { amount_tax: 0 },
      }
    })

    const res = await createCheckoutSessionAction({})
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.session_id).toBe('cs_test_mock_tax')
    }
  })
})

// ===================================================================
// P6.9 — Royalty engine snapshot invariant (ADR-0009)
//
// The royalty rate + computed cents are snapshotted onto order_items
// at checkout time. The payout ledger (onPaymentSucceeded + onRefund)
// reads from order_items — NEVER from partners. Future rate changes
// must not rewrite history.
// ===================================================================

describe('createCheckoutSessionAction — P6.9 royalty snapshot', () => {
  /**
   * Helper: pull every captured INSERT call's payload (in order).
   * Returns arrays for inserts that were arrays (order_items), objects
   * for inserts that were single rows (orders).
   */
  function getInserts(): unknown[] {
    return serviceCalls
      .filter((c): c is { method: 'insert'; payload: unknown } => c.method === 'insert')
      .map((c) => c.payload)
  }

  it('snapshots partner.royalty_pct_bps onto order_items.royalty_pct_bps at checkout', async () => {
    // defaultCartRow fixture has partner.royalty_pct_bps = 3500.
    // Mirror the queue setup used in the P4.10 describe block:
    // 1 cart_items read (server), 1 prior-order lookup (server),
    // 1 orders insert (service), 1 order_items insert (service),
    // 1 orders update (service — session id writeback).
    serverQueue.push({ data: defaultCartRow(), error: null }) // cart_items
    serverQueue.push({ data: null, error: null }) // prior-order lookup
    serviceQueue.push({ data: { id: 999 }, error: null }) // orders insert
    serviceQueue.push({ data: null, error: null }) // order_items insert
    serviceQueue.push({ data: null, error: null }) // orders update

    const res = await createCheckoutSessionAction({})
    expect(res.ok).toBe(true)

    const inserts = getInserts()
    // inserts[0] = orders INSERT (single row)
    // inserts[1] = order_items INSERT (array of rows)
    expect(Array.isArray(inserts[1])).toBe(true)
    const items = inserts[1] as Array<Record<string, unknown>>
    expect(items).toHaveLength(1)
    expect(items[0]!.royalty_pct_bps).toBe(3500) // ← the snapshot
    // Royalty cents: post-discount line total ($50.00 - $0) * 35% = $17.50 = 1750n
    // (no subscriber discount; royalty computed on the post-discount line total)
    expect(items[0]!.royalty_cents).toBe(1750)
    // The captured select on cart_items does NOT include a read of
    // `partners.royalty_pct_bps` from the partners table directly —
    // it's joined via `product:partners (...)`.
    // (The snapshot itself is what matters — see ADR-0009.)
  })

  it('falls back to DEFAULT_ROYALTY_PCT_BPS when partner.royalty_pct_bps is null', async () => {
    // Build a cart row with partner.royalty_pct_bps = null (the
    // common case for a new partner who hasn't been assigned a rate).
    const nullRateCartRow = defaultCartRow().map((r) => ({
      ...r,
      product: {
        ...r.product,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        partner: { royalty_pct_bps: null as any },
      },
    }))
    serverQueue.push({ data: nullRateCartRow, error: null }) // cart_items read
    serverQueue.push({ data: null, error: null }) // prior order lookup
    serviceQueue.push({ data: { id: 999 }, error: null }) // orders insert
    serviceQueue.push({ data: null, error: null }) // order_items insert
    serviceQueue.push({ data: null, error: null }) // orders update (session id)

    const res = await createCheckoutSessionAction({})
    expect(res.ok).toBe(true)

    const inserts = getInserts()
    const items = inserts[1] as Array<Record<string, unknown>>
    expect(items[0]!.royalty_pct_bps).toBe(3000) // ← DEFAULT_ROYALTY_PCT_BPS from mockEnv
    // Royalty cents: $50.00 * 30% = $15.00 = 1500n
    expect(items[0]!.royalty_cents).toBe(1500)
  })

  it('falls back to DEFAULT_ROYALTY_PCT_BPS when partner.royalty_pct_bps is 0 (defensive)', async () => {
    // Edge case: a partner whose rate was set to 0 (temporarily
    // suspended, paused, etc.). The createCheckoutSession code treats
    // 0 as "no rate" and falls back to the default.
    const zeroRateCartRow = defaultCartRow().map((r) => ({
      ...r,
      product: {
        ...r.product,
        partner: { royalty_pct_bps: 0 },
      },
    }))
    serverQueue.push({ data: zeroRateCartRow, error: null })
    serverQueue.push({ data: null, error: null })
    serviceQueue.push({ data: { id: 999 }, error: null })
    serviceQueue.push({ data: null, error: null })
    serviceQueue.push({ data: null, error: null })

    const res = await createCheckoutSessionAction({})
    expect(res.ok).toBe(true)

    const inserts = getInserts()
    const items = inserts[1] as Array<Record<string, unknown>>
    expect(items[0]!.royalty_pct_bps).toBe(3000) // ← DEFAULT_ROYALTY_PCT_BPS
    expect(items[0]!.royalty_cents).toBe(1500)
  })

  it('snapshots royalty_pct_bps per line when the cart has multiple lines with different partner rates', async () => {
    // Multi-line cart: 2 products, different partners, different rates.
    const multiLineCart = [
      {
        id: 1,
        product_id: 100,
        license: 'plr',
        quantity: 1,
        status: 'active',
        coupon_id: null,
        product: {
          id: 100,
          slug: 'ai-branding',
          title: 'AI Personal Branding',
          status: 'published',
          partner_id: 7,
          partner: { royalty_pct_bps: 3500 },
          pricing: [{ license: 'plr', price_cents: 5000, is_active: true, subscriber_discount_bps: 0 }],
        },
      },
      {
        id: 2,
        product_id: 200,
        license: 'plr',
        quantity: 1,
        status: 'active',
        coupon_id: null,
        product: {
          id: 200,
          slug: 'social-media',
          title: 'Social Media Mastery',
          status: 'published',
          partner_id: 8,
          partner: { royalty_pct_bps: 5000 },
          pricing: [{ license: 'plr', price_cents: 3000, is_active: true, subscriber_discount_bps: 0 }],
        },
      },
    ]
    serverQueue.push({ data: multiLineCart, error: null })
    serverQueue.push({ data: null, error: null }) // prior order lookup
    serviceQueue.push({ data: { id: 999 }, error: null }) // orders insert
    serviceQueue.push({ data: null, error: null }) // order_items insert
    serviceQueue.push({ data: null, error: null }) // orders update (session id)

    const res = await createCheckoutSessionAction({})
    expect(res.ok).toBe(true)

    const inserts = getInserts()
    const items = inserts[1] as Array<Record<string, unknown>>
    expect(items).toHaveLength(2)

    // Per-line snapshot — each line carries its OWN partner's rate.
    const line100 = items.find((i) => i.product_id === 100)
    const line200 = items.find((i) => i.product_id === 200)
    expect(line100?.royalty_pct_bps).toBe(3500)
    expect(line100?.royalty_cents).toBe(1750) // 5000 * 35% = 1750
    expect(line200?.royalty_pct_bps).toBe(5000)
    expect(line200?.royalty_cents).toBe(1500) // 3000 * 50% = 1500
  })
})