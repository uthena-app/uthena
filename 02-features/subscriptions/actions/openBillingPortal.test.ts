// openBillingPortal.test.ts — unit tests for the openBillingPortalAction
// server action.
//
// Covers (mirroring startSubscription.test.ts):
//   - Input validation (empty object + FormData-shaped input).
//   - Auth branch — anonymous users get `not_authed`.
//   - Stripe configured gate — when `STRIPE_SECRET_KEY` is empty, returns
//     `stripe_unconfigured` without touching the DB.
//   - Subscription lookup — when the user has no row, returns `no_customer`.
//   - Subscription lookup — when the row exists but `stripe_customer_id`
//     is null, returns `no_customer` (no Stripe call, no URL minted).
//   - **Happy path** — calls `stripe.billingPortal.sessions.create()`
//     with the user's `stripe_customer_id` + a `return_url` built from
//     the request origin (not the env fallback) when an `origin` header
//     is present.
//   - **return_url fallback** — when no `origin` header is present,
//     falls back to `NEXT_PUBLIC_APP_URL/account/subscriptions`.
//   - **Idempotency key** — `bucketedIdempotencyKey('billing_portal', 60,
//     user.id)` is passed to the Stripe SDK as the `idempotencyKey`.
//   - **Portal URL missing** — when Stripe returns a session without a
//     `url`, returns the `unknown` error code (defensive — has not been
//     observed in practice, but the action short-circuits cleanly).
//   - **Typed-error path** — when `withStripeErrorHandling` returns
//     `ok:false`, the action surfaces the wrapper's classifier message
//     verbatim and the `code` is `'unknown'`.
//   - **PII safety on happy path** — no log lines on the happy path;
//     only PII-safe fields when logs do fire (currently nowhere).
//
// Note: there is no "catch-all" test for `getStripe()` itself throwing
// synchronously (e.g. SDK init failure). The action mirrors
// `startSubscription.ts` — it does not wrap `getStripe()` in a try/catch.
// Only `resumeSubscription.ts` and `cancelAtPeriodEnd.ts` add that
// defensive layer. If a future tick adds it here too, mirror the
// catch-all tests from `resumeSubscription.test.ts`.
//     no email, no Stripe Customer ID, no token.
//
// Strategy: vi.mock `next/headers` (origin), the Supabase server client
// (chainable fake with terminalQueue for the subscription-row lookup),
// the auth guard (controllable user), the Stripe wrapper (captures the
// params passed to `.billingPortal.sessions.create()` so we can assert
// the shape + idempotency key + URL return), the env helper
// (controllable `STRIPE_SECRET_KEY` + `NEXT_PUBLIC_APP_URL`), the
// logger, and the idempotency helper.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ----- Mock next/headers ----------------------------------------------
// Controllable origin: tests opt in to "origin header present" or
// "fall back to NEXT_PUBLIC_APP_URL" by toggling the local var.
let mockOrigin: string | null = 'https://uthena.com'
vi.mock('next/headers', () => ({
  headers: vi.fn(async () => ({
    get: (name: string) => (name === 'origin' ? mockOrigin : null),
  })),
}))

// ----- Mock @foundations/env -----------------------------------------
const mockEnv = {
  STRIPE_SECRET_KEY: 'sk_test_mock',
  NEXT_PUBLIC_APP_URL: 'https://app.example.test',
}
vi.mock('@foundations/env', () => ({
  getEnv: () => mockEnv,
}))

// ----- Mock @foundations/money/stripe -------------------------------
let stripeConfigured = true
let portalResult: { url: string | null } = { url: 'https://billing.stripe.com/p/session/test_abc' }
let portalCallError: Error | null = null
let capturedPortalParams: { params: unknown; opts: unknown } | null = null

const fakeStripe = {
  billingPortal: {
    sessions: {
      create: vi.fn(async (params: unknown, opts?: unknown) => {
        if (portalCallError) throw portalCallError
        capturedPortalParams = { params, opts: opts ?? null }
        return { url: portalResult.url }
      }),
    },
  },
}
vi.mock('@foundations/money/stripe', () => ({
  isStripeConfigured: vi.fn(() => stripeConfigured),
  getStripe: vi.fn(() => fakeStripe),
  withStripeErrorHandling: vi.fn(async (fn: () => Promise<unknown>) => {
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
    (scope: string, bucketSeconds: number, ...parts: unknown[]) =>
      `${scope}:${bucketSeconds}:${parts.join(':')}`,
  ),
}))

// ----- Mock the Supabase server client ------------------------------
// The action only does ONE read on `subscriptions`: select(stripe_customer_id)
// .eq(user_id, id).maybeSingle(). We model that as a chain with terminalQueue.
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
}

vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: vi.fn(async () => fakeServerSupabase),
  getServiceSupabase: vi.fn(() => fakeServerSupabase),
}))

// ----- Mock auth guard ----------------------------------------------
let mockUser: { id: string; email: string | null } | null = null
vi.mock('@foundations/auth/guards', () => ({
  getSessionUser: vi.fn(async () => mockUser),
}))

// ----- Mock logger (capture for PII-safety assertions) --------------
const logCalls: Array<{ level: string; payload: unknown; msg: string | undefined }> = []
vi.mock('@foundations/log/pino', () => ({
  loggerFor: () => ({
    info: (payload: unknown, msg?: string) => {
      logCalls.push({ level: 'info', payload, msg })
    },
    warn: (payload: unknown, msg?: string) => {
      logCalls.push({ level: 'warn', payload, msg })
    },
    error: (payload: unknown, msg?: string) => {
      logCalls.push({ level: 'error', payload, msg })
    },
    debug: (payload: unknown, msg?: string) => {
      logCalls.push({ level: 'debug', payload, msg })
    },
  }),
}))

// ----- Import after mocks ------------------------------------------
const { openBillingPortalAction } = await import('./openBillingPortal')

beforeEach(() => {
  serverCalls.length = 0
  serverQueue = []
  logCalls.length = 0
  capturedPortalParams = null
  portalResult = { url: 'https://billing.stripe.com/p/session/test_abc' }
  portalCallError = null
  stripeConfigured = true
  mockUser = { id: 'user-1', email: 'user@example.com' }
  mockOrigin = 'https://uthena.com'
  fakeServerSupabase.from.mockClear()
  fakeStripe.billingPortal.sessions.create.mockClear()
})

afterEach(() => {
  vi.clearAllMocks()
})

// ===================================================================
// Input validation
// ===================================================================

describe('openBillingPortalAction — input validation', () => {
  it('accepts an empty object (no fields required in v1)', async () => {
    serverQueue.push({
      data: { stripe_customer_id: 'cus_test_1' },
      error: null,
    })

    const res = await openBillingPortalAction({})
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.url).toMatch(/^https:\/\/billing\.stripe\.com\//)
  })

  it('accepts a FormData-shaped input as well (forms post to server actions)', async () => {
    serverQueue.push({
      data: { stripe_customer_id: 'cus_test_1' },
      error: null,
    })

    const fd = new FormData()
    const res = await openBillingPortalAction(fd)
    expect(res.ok).toBe(true)
  })
})

// ===================================================================
// Auth gating
// ===================================================================

describe('openBillingPortalAction — auth gating', () => {
  it('returns not_authed when no user is signed in', async () => {
    mockUser = null

    const res = await openBillingPortalAction({})
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe('not_authed')
      expect(res.error).toMatch(/sign in/i)
    }

    // No DB call, no Stripe call when unauthed.
    expect(fakeServerSupabase.from).not.toHaveBeenCalled()
    expect(fakeStripe.billingPortal.sessions.create).not.toHaveBeenCalled()
  })
})

// ===================================================================
// Stripe-unconfigured gate
// ===================================================================

describe('openBillingPortalAction — Stripe-unconfigured gate', () => {
  it('returns stripe_unconfigured when STRIPE_SECRET_KEY is empty', async () => {
    stripeConfigured = false

    const res = await openBillingPortalAction({})
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe('stripe_unconfigured')
      expect(res.error).toMatch(/stripe.*not configured/i)
    }

    // No DB call, no Stripe call when Stripe is unconfigured.
    expect(fakeServerSupabase.from).not.toHaveBeenCalled()
    expect(fakeStripe.billingPortal.sessions.create).not.toHaveBeenCalled()
  })
})

// ===================================================================
// Subscription lookup — no row
// ===================================================================

describe('openBillingPortalAction — subscription lookup', () => {
  it('returns no_customer when the user has no subscription row', async () => {
    serverQueue.push({ data: null, error: null })

    const res = await openBillingPortalAction({})
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe('no_customer')
      expect(res.error).toMatch(/start a subscription/i)
    }

    // Critical: even though the user is authed and Stripe is configured,
    // no portal session is minted when there's no customer to attach it to.
    expect(fakeStripe.billingPortal.sessions.create).not.toHaveBeenCalled()
  })

  it('returns no_customer when the row exists but stripe_customer_id is null', async () => {
    serverQueue.push({
      data: { stripe_customer_id: null },
      error: null,
    })

    const res = await openBillingPortalAction({})
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe('no_customer')
      expect(res.error).toMatch(/start a subscription/i)
    }

    expect(fakeStripe.billingPortal.sessions.create).not.toHaveBeenCalled()
  })
})

// ===================================================================
// Happy path
// ===================================================================

describe('openBillingPortalAction — happy path', () => {
  function setupCustomer() {
    serverQueue.push({
      data: { stripe_customer_id: 'cus_test_1' },
      error: null,
    })
  }

  it('calls stripe.billingPortal.sessions.create with the user stripe_customer_id', async () => {
    setupCustomer()

    const res = await openBillingPortalAction({})
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.url).toBe('https://billing.stripe.com/p/session/test_abc')
    }

    expect(capturedPortalParams).not.toBeNull()
    const params = capturedPortalParams!.params as Record<string, unknown>
    expect(params.customer).toBe('cus_test_1')
  })

  it('builds return_url from the request origin header', async () => {
    setupCustomer()
    mockOrigin = 'https://uthena.com'

    const res = await openBillingPortalAction({})
    expect(res.ok).toBe(true)

    const params = capturedPortalParams!.params as Record<string, unknown>
    expect(params.return_url).toBe('https://uthena.com/account/subscriptions')
  })

  it('falls back to NEXT_PUBLIC_APP_URL when no origin header is present', async () => {
    setupCustomer()
    mockOrigin = null

    const res = await openBillingPortalAction({})
    expect(res.ok).toBe(true)

    const params = capturedPortalParams!.params as Record<string, unknown>
    expect(params.return_url).toBe('https://app.example.test/account/subscriptions')
  })

  it('passes an idempotency key from bucketedIdempotencyKey("billing_portal", 60, user.id)', async () => {
    setupCustomer()

    const res = await openBillingPortalAction({})
    expect(res.ok).toBe(true)

    const opts = capturedPortalParams!.opts as Record<string, unknown>
    expect(opts).not.toBeNull()
    expect(typeof opts.idempotencyKey).toBe('string')
    // Format: "billing_portal:60:user-1" — scope, bucket, user id.
    expect((opts.idempotencyKey as string).startsWith('billing_portal:')).toBe(true)
    expect((opts.idempotencyKey as string)).toContain('user-1')
  })

  it('reads only stripe_customer_id from the subscriptions row (column projection)', async () => {
    setupCustomer()

    const res = await openBillingPortalAction({})
    expect(res.ok).toBe(true)

    const fromCall = serverCalls.find((c) => c.method === 'from')
    expect(fromCall).toBeDefined()
    if (fromCall && fromCall.method === 'from') {
      expect(fromCall.table).toBe('subscriptions')
    }

    const selectCall = serverCalls.find((c) => c.method === 'select')
    expect(selectCall).toBeDefined()
    if (selectCall && selectCall.method === 'select') {
      expect(selectCall.payload).toBe('stripe_customer_id')
    }

    const eqCall = serverCalls.find((c) => c.method === 'eq')
    expect(eqCall).toBeDefined()
    if (eqCall && eqCall.method === 'eq') {
      expect(eqCall.col).toBe('user_id')
      expect(eqCall.val).toBe('user-1')
    }
  })
})

// ===================================================================
// Portal URL missing
// ===================================================================

describe('openBillingPortalAction — portal URL missing', () => {
  it('returns the unknown error code when Stripe returns a session without a url', async () => {
    serverQueue.push({
      data: { stripe_customer_id: 'cus_test_1' },
      error: null,
    })
    portalResult = { url: null }

    const res = await openBillingPortalAction({})
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe('unknown')
      expect(res.error).toMatch(/portal url missing/i)
    }
  })
})

// ===================================================================
// Stripe error handling — typed-error path (wrapper returns ok:false)
// ===================================================================

describe('openBillingPortalAction — Stripe error (typed-error path)', () => {
  it('surfaces the wrapper classifier message and does NOT return a url', async () => {
    serverQueue.push({
      data: { stripe_customer_id: 'cus_test_1' },
      error: null,
    })
    portalCallError = new Error('stripe_api_error: customer not found')

    const res = await openBillingPortalAction({})
    expect(res.ok).toBe(false)
    if (!res.ok) {
      // The action returns the wrapper's message verbatim on the
      // typed-error path (the wrapper's classifier message is already
      // user-safe; re-wrapping it would be a lie).
      expect(res.error).toBe('stripe_api_error: customer not found')
      expect(res.code).toBe('unknown')
    }
  })

  it('typed-error path does NOT emit a warn log (wrapper already logged it)', async () => {
    // The catch-block warning only fires when the wrapper itself throws
    // (an unexpected error class). On the typed-error path, the wrapper
    // has already logged the classified error with a typed `code` — a
    // second warn call would double-log.
    serverQueue.push({
      data: { stripe_customer_id: 'cus_test_1' },
      error: null,
    })
    portalCallError = new Error('card_declined')

    await openBillingPortalAction({})

    const warns = logCalls.filter((l) => l.level === 'warn')
    expect(warns).toHaveLength(0)
  })
})

// ===================================================================
// PII safety on the happy path
// ===================================================================

describe('openBillingPortalAction — PII safety on happy path', () => {
  it('emits no log lines on the happy path (no email, no Stripe customer id)', async () => {
    // P5.6 invariant: the happy-path minting of a portal URL is silent —
    // no log line is emitted. Logging "user X minted a billing portal
    // URL" is noise; the Stripe webhook + DB row carry that signal.
    serverQueue.push({
      data: { stripe_customer_id: 'cus_test_1' },
      error: null,
    })

    const res = await openBillingPortalAction({})
    expect(res.ok).toBe(true)

    // If we add log calls here in the future, assert PII safety: no
    // email, no Stripe customer id, no token. For now, no logs is the
    // assertion.
    expect(logCalls).toHaveLength(0)
  })

  it('does not leak email or stripe_customer_id in the return value', async () => {
    serverQueue.push({
      data: { stripe_customer_id: 'cus_test_1' },
      error: null,
    })

    const res = await openBillingPortalAction({})
    expect(res.ok).toBe(true)
    if (res.ok) {
      // The result shape is { ok: true, url }. No email, no
      // stripe_customer_id, no token should leak into the returned
      // object — the URL is the only forwardable artifact.
      const json = JSON.stringify(res)
      expect(json).not.toMatch(/user@example\.com/)
      expect(json).not.toMatch(/cus_test_1/)
      expect(json).not.toMatch(/sk_/)
    }
  })
})
