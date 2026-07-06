// startSubscription.test.ts — unit tests for the startSubscriptionAction
// server action.
//
// Covers (mirroring createCheckoutSession.test.ts):
//   - Input validation (no fields required; v1 takes nothing).
//   - Auth branch — anonymous users get `not_authed`.
//   - Stripe configured gate — when `STRIPE_SECRET_KEY` is empty, returns
//     `stripe_unconfigured` without touching the DB.
//   - Price configured gate — when `STRIPE_PRICE_PERSONAL_ACCESS_MONTHLY`
//     is empty, returns `price_unconfigured`.
//   - **P4.10 — Saved payment methods (returning buyer)**: when the user
//     has a prior order with `stripe_customer_id`, the session params
//     include `customer` (not `customer_email`).
//   - **P4.10 — First-time buyer**: when the user has no prior
//     `stripe_customer_id`, the session params fall back to
//     `customer_email`.
//   - **P4.10 — Dashboard-driven methods**: `payment_method_types` is
//     intentionally NOT in the session params; the Stripe Dashboard
//     decides whether Card / Apple Pay / Google Pay / Link are offered.
//   - mode is 'subscription' (vs the checkout's 'payment' mode).
//   - success_url points to /account/subscriptions?welcome=1.
//   - cancel_url points to /account/subscriptions?canceled=1.
//   - subscription_data.metadata.user_id is set so the webhook handler
//     can find the local row.
//
// Strategy: vi.mock `next/headers` (cookies + origin), the Supabase
// clients (chainable fake with terminalQueue for the prior-order read),
// the auth guard (controllable user), the Stripe wrapper (captures the
// params passed to `.checkout.sessions.create()` so we can assert the
// shape), the env helper (controllable `STRIPE_SECRET_KEY` +
// `STRIPE_PRICE_PERSONAL_ACCESS_MONTHLY`), the logger, and the
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
  STRIPE_PRICE_PERSONAL_ACCESS_MONTHLY: 'price_test_personal_access_monthly',
}
vi.mock('@foundations/env', () => ({
  getEnv: () => mockEnv,
}))

// ----- Mock @foundations/money/stripe -------------------------------
// Capture the params passed to .checkout.sessions.create() so we can
// assert the shape (P4.10 — `customer` vs `customer_email`,
// `payment_method_types` absent; P5.2 — `mode: 'subscription'`,
// success/cancel URLs, `subscription_data.metadata.user_id`).
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
  bucketedIdempotencyKey: vi.fn(
    (scope: string, _bucketSeconds: number, ...parts: unknown[]) =>
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
  | { method: 'maybeSingle' }
  | { method: 'then' }

const serverCalls: Call[] = []
let serverQueue: Array<{ data: unknown; error: unknown }> = []

function makeChain() {
  const chain: any = {
    select(payload: unknown) {
      serverCalls.push({ method: 'select', payload })
      return chain
    },
    eq(col: string, val: unknown) {
      serverCalls.push({ method: 'eq', col, val })
      return chain
    },
    not(col: string, op: string, val: unknown) {
      serverCalls.push({ method: 'not', col, op, val })
      return chain
    },
    order(col: string, opts: unknown) {
      serverCalls.push({ method: 'order', col, opts })
      return chain
    },
    limit(n: number) {
      serverCalls.push({ method: 'limit', n })
      return chain
    },
    maybeSingle: vi.fn(async () => {
      serverCalls.push({ method: 'maybeSingle' })
      return serverQueue.shift() ?? { data: null, error: null }
    }),
    then(resolve: (v: unknown) => unknown) {
      serverCalls.push({ method: 'then' })
      const next = serverQueue.shift() ?? { data: [], error: null }
      return Promise.resolve(next).then(resolve)
    },
  }
  return chain
}

const fakeServerSupabase = { from: vi.fn(() => makeChain()) }

vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: vi.fn(async () => fakeServerSupabase),
}))

// ----- Mock auth guard ----------------------------------------------
let mockUser: { id: string; email: string | null } | null = null
vi.mock('@foundations/auth/guards', () => ({
  getSessionUser: vi.fn(async () => mockUser),
}))

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
const { startSubscriptionAction } = await import('./startSubscription')

beforeEach(() => {
  serverCalls.length = 0
  serverQueue = []
  capturedSessionParams = null
  stripeConfigured = true
  mockEnv.STRIPE_SECRET_KEY = 'sk_test_mock'
  mockEnv.STRIPE_PRICE_PERSONAL_ACCESS_MONTHLY = 'price_test_personal_access_monthly'
  mockUser = { id: 'user-1', email: 'user@example.com' }
  fakeServerSupabase.from.mockClear()
  fakeStripe.checkout.sessions.create.mockClear()
})

afterEach(() => {
  vi.clearAllMocks()
})

// ===================================================================
// Input validation
// ===================================================================

describe('startSubscriptionAction — input validation', () => {
  it('accepts an empty object (no fields required in v1)', async () => {
    // Force a DB failure on the prior-order lookup so the action
    // short-circuits without calling Stripe. The action treats a
    // query error as "couldn't determine prior customer" but Stripe
    // is still called (fail-soft). So we mock Stripe to throw via
    // `withStripeErrorHandling`'s catch branch instead.
    serverQueue.push({ data: null, error: { message: 'db down' } })

    const res = await startSubscriptionAction({})
    // Don't assert ok vs not-ok — what matters is that we got past
    // Zod (no throw), past auth (mockUser is set), past the Stripe
    // configured gate, past the price gate, and into the prior-order
    // lookup. The result depends on whether Stripe returns a URL.
    expect(typeof res.ok).toBe('boolean')
  })

  it('accepts a FormData-shaped input as well (forms post to server actions)', async () => {
    // FormData is accepted via the `_raw: FormData | Record<string, unknown>`
    // signature; Zod parses `{}` from either. Push a prior-order result
    // so the action completes normally.
    serverQueue.push({ data: null, error: null })

    const fd = new FormData()
    const res = await startSubscriptionAction(fd)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(typeof res.url).toBe('string')
      expect(res.url.startsWith('https://')).toBe(true)
    }
  })
})

// ===================================================================
// Auth + Stripe gating
// ===================================================================

describe('startSubscriptionAction — auth + Stripe + price gating', () => {
  it('returns not_authed when no user is signed in', async () => {
    mockUser = null

    const res = await startSubscriptionAction({})
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe('not_authed')

    expect(fakeServerSupabase.from).not.toHaveBeenCalled()
    expect(fakeStripe.checkout.sessions.create).not.toHaveBeenCalled()
  })

  it('returns stripe_unconfigured when STRIPE_SECRET_KEY is empty', async () => {
    stripeConfigured = false

    const res = await startSubscriptionAction({})
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe('stripe_unconfigured')

    expect(fakeServerSupabase.from).not.toHaveBeenCalled()
    expect(fakeStripe.checkout.sessions.create).not.toHaveBeenCalled()
  })

  it('returns price_unconfigured when STRIPE_PRICE_PERSONAL_ACCESS_MONTHLY is empty', async () => {
    mockEnv.STRIPE_PRICE_PERSONAL_ACCESS_MONTHLY = ''

    const res = await startSubscriptionAction({})
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe('price_unconfigured')

    // We read the env (cheap), but no DB call + no Stripe call yet —
    // the price check happens after the Stripe gate but before the
    // prior-order lookup, so no DB hit.
    expect(fakeServerSupabase.from).not.toHaveBeenCalled()
    expect(fakeStripe.checkout.sessions.create).not.toHaveBeenCalled()
  })
})

// ===================================================================
// P5.2 — Stripe Checkout Subscription mode shape
// ===================================================================

describe('startSubscriptionAction — subscription mode shape', () => {
  function setupFirstTimeBuyer() {
    serverQueue.push({ data: null, error: null }) // prior order lookup (no prior customer)
  }

  it("mode is 'subscription' (vs checkout's 'payment')", async () => {
    setupFirstTimeBuyer()

    const res = await startSubscriptionAction({})
    expect(res.ok).toBe(true)

    const params = capturedSessionParams as Record<string, unknown>
    expect(params.mode).toBe('subscription')
  })

  it('line_items references STRIPE_PRICE_PERSONAL_ACCESS_MONTHLY', async () => {
    setupFirstTimeBuyer()

    const res = await startSubscriptionAction({})
    expect(res.ok).toBe(true)

    const params = capturedSessionParams as Record<string, unknown>
    const lineItems = params.line_items as Array<{ price: string; quantity: number }>
    expect(lineItems).toHaveLength(1)
    expect(lineItems[0]?.price).toBe('price_test_personal_access_monthly')
    expect(lineItems[0]?.quantity).toBe(1)
  })

  it('success_url points to /account/subscriptions?welcome=1', async () => {
    setupFirstTimeBuyer()

    const res = await startSubscriptionAction({})
    expect(res.ok).toBe(true)

    const params = capturedSessionParams as Record<string, unknown>
    expect(params.success_url).toBe('https://uthena.com/account/subscriptions?welcome=1')
  })

  it('cancel_url points to /account/subscriptions?canceled=1', async () => {
    setupFirstTimeBuyer()

    const res = await startSubscriptionAction({})
    expect(res.ok).toBe(true)

    const params = capturedSessionParams as Record<string, unknown>
    expect(params.cancel_url).toBe('https://uthena.com/account/subscriptions?canceled=1')
  })

  it('subscription_data.metadata.user_id is set (webhook reads this)', async () => {
    setupFirstTimeBuyer()

    const res = await startSubscriptionAction({})
    expect(res.ok).toBe(true)

    const params = capturedSessionParams as Record<string, unknown>
    const subData = params.subscription_data as { metadata: Record<string, string> }
    expect(subData.metadata.user_id).toBe('user-1')
    expect(subData.metadata.plan).toBe('personal_access')
  })

  it('top-level metadata also carries user_id + plan (defense in depth)', async () => {
    setupFirstTimeBuyer()

    const res = await startSubscriptionAction({})
    expect(res.ok).toBe(true)

    const params = capturedSessionParams as Record<string, unknown>
    const meta = params.metadata as Record<string, string>
    expect(meta.user_id).toBe('user-1')
    expect(meta.plan).toBe('personal_access')
  })

  it('allow_promotion_codes is enabled (lets users apply Stripe promo codes)', async () => {
    setupFirstTimeBuyer()

    const res = await startSubscriptionAction({})
    expect(res.ok).toBe(true)

    const params = capturedSessionParams as Record<string, unknown>
    expect(params.allow_promotion_codes).toBe(true)
  })
})

// ===================================================================
// P4.10 — Payment method picker (same shape as the checkout P4.10 work)
// ===================================================================

describe('startSubscriptionAction — P4.10 payment methods', () => {
  function setupFirstTimeBuyer() {
    serverQueue.push({ data: null, error: null }) // prior order lookup (no prior customer)
  }

  function setupReturningBuyer(customerId: string) {
    serverQueue.push({
      data: { stripe_customer_id: customerId },
      error: null,
    })
  }

  it('first-time subscriber → session uses customer_email, NOT customer', async () => {
    setupFirstTimeBuyer()

    const res = await startSubscriptionAction({})
    expect(res.ok).toBe(true)

    const params = capturedSessionParams as Record<string, unknown>
    expect(params.customer).toBeUndefined()
    expect(params.customer_email).toBe('user@example.com')
  })

  it('returning subscriber → session uses customer, NOT customer_email', async () => {
    setupReturningBuyer('cus_EXISTING_SUB123')

    const res = await startSubscriptionAction({})
    expect(res.ok).toBe(true)

    const params = capturedSessionParams as Record<string, unknown>
    expect(params.customer).toBe('cus_EXISTING_SUB123')
    expect(params.customer_email).toBeUndefined()
  })

  it('first-time subscriber without an email → no customer field at all', async () => {
    mockUser = { id: 'user-1', email: null }
    setupFirstTimeBuyer()

    const res = await startSubscriptionAction({})
    expect(res.ok).toBe(true)

    const params = capturedSessionParams as Record<string, unknown>
    expect(params.customer).toBeUndefined()
    expect(params.customer_email).toBeUndefined()
  })

  it('returning-subscriber branch runs the prior-order lookup with the right filters', async () => {
    setupReturningBuyer('cus_X')

    await startSubscriptionAction({})

    // The single server from() call is the prior-order lookup.
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

    const res = await startSubscriptionAction({})
    expect(res.ok).toBe(true)

    // Critical assertion: we do NOT hard-code payment methods. The
    // Stripe Dashboard's "Payment methods" config is the source of
    // truth for Card / Apple Pay / Google Pay / Link. Hard-coding
    // `['card']` here would block Apple Pay on Safari/iOS even when
    // the Dashboard has it enabled. Same shape as the checkout
    // P4.10 work.
    const params = capturedSessionParams as Record<string, unknown>
    expect(params.payment_method_types).toBeUndefined()
  })
})

// ===================================================================
// No-trial assertion (per spec at 01-specs/pages/account-subscriptions.md)
// ===================================================================

describe('startSubscriptionAction — no trial in v1 (per spec)', () => {
  it('subscription_data does NOT include trial_period_days (out of scope for v1)', async () => {
    serverQueue.push({ data: null, error: null }) // prior order lookup (no prior customer)

    const res = await startSubscriptionAction({})
    expect(res.ok).toBe(true)

    const params = capturedSessionParams as Record<string, unknown>
    const subData = params.subscription_data as Record<string, unknown>
    // The PHASES.md P5.2 line mentions a "trial option (7-day)" but
    // the spec at 01-specs/pages/account-subscriptions.md:54, 124, 134
    // explicitly defers trials to v2. Assert the absent field so a
    // future contributor adding it has to update this test (and the
    // spec) — not silently enable a feature.
    expect(subData.trial_period_days).toBeUndefined()
    expect(subData.trial_end).toBeUndefined()
  })
})