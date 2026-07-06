// resumeSubscription.test.ts — unit tests for the resumeSubscriptionAction
// server action.
//
// Covers (mirroring startSubscription.test.ts):
//   - Input validation (no fields required; v1 takes nothing).
//   - Auth branch — anonymous users get a clear error.
//   - **Idempotency** — when `cancel_at_period_end` is already false,
//     the action short-circuits with `wasScheduled: false` and does
//     NOT touch Stripe or the DB.
//   - **No subscription row** — returns a clear "No subscription found."
//   - **Period ended** — returns a clear "This subscription has ended"
//     message and does NOT touch Stripe.
//   - **Stripe unconfigured path** — updates the local row directly
//     via the service-role client (bypassing Stripe entirely).
//   - **Happy path with Stripe** — calls
//     `stripe.subscriptions.update(id, { cancel_at_period_end: false }, { idempotencyKey })`,
//     then mirrors the change to the local row.
//   - **Stripe call fails** — returns a clear error, does NOT mirror
//     the local row (the subscription is still canceled at Stripe).
//   - **Idempotency key shape** — `idempotencyKey('sub_resume', sub.id)`
//     used as the Stripe idempotency key (stable across retries).
//   - **PII safety** — log line uses `user_id` + `subscription_id`
//     only; no email, no Stripe customer/sub IDs.
//   - **revalidatePath('/account/subscriptions')** is called on the
//     happy path so the UI reflects the change on next render.
//
// Strategy: vi.mock `next/cache` (no-op revalidatePath), the Supabase
// clients (chainable fake with terminalQueue for the SELECT), the
// auth guard (controllable user), the Stripe wrapper (captures the
// params passed to `.subscriptions.update()` so we can assert the
// shape), the env helper (controllable Stripe configured), and the
// logger (capture calls for PII-safety assertions).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ----- Mock next/cache -----------------------------------------------
// revalidatePath is a no-op in tests; we capture calls for assertions.
const revalidateCalls: string[] = []
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn((path: string) => {
    revalidateCalls.push(path)
  }),
}))

// ----- Mock @foundations/env -----------------------------------------
let stripeConfigured = true
vi.mock('@foundations/env', () => ({
  getEnv: () => ({
    STRIPE_SECRET_KEY: stripeConfigured ? 'sk_test_mock' : '',
  }),
}))

// ----- Mock @foundations/money/stripe -------------------------------
// Capture the params passed to .subscriptions.update() so we can
// assert the shape (`cancel_at_period_end: false` + the idempotency
// key passed through the 3rd arg).
let capturedUpdateParams:
  | { id: string; body: unknown; opts: unknown }
  | null = null
let stripeError: Error | null = null
const fakeStripe = {
  subscriptions: {
    update: vi.fn(async (id: string, body: unknown, opts?: unknown) => {
      if (stripeError) throw stripeError
      capturedUpdateParams = { id, body, opts: opts ?? null }
      return {
        id,
        cancel_at_period_end: false,
        status: 'active',
        current_period_end: Math.floor(Date.now() / 1000) + 86400 * 30,
      }
    }),
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
  idempotencyKey: vi.fn((scope: string, ...parts: unknown[]) => {
    // Mirror the real shape closely enough for assertions.
    return `${scope}:${parts.join(':')}`
  }),
}))

// ----- Mock the Supabase clients ------------------------------------
// Server client handles the SELECT. Service client handles the UPDATE.
// Each gets its own chain to keep the call lists clean.
type ServerCall =
  | { method: 'select'; payload: unknown }
  | { method: 'eq'; col: string; val: unknown }
  | { method: 'maybeSingle' }

type ServiceCall =
  | { method: 'from'; table: string }
  | { method: 'update'; payload: unknown }
  | { method: 'eq'; col: string; val: unknown }
  | { method: 'then' }

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

const serviceCalls: ServiceCall[] = []

function makeServiceChain() {
  const chain: any = {
    update(payload: unknown) {
      serviceCalls.push({ method: 'update', payload })
      return chain
    },
    eq(col: string, val: unknown) {
      serviceCalls.push({ method: 'eq', col, val })
      return chain
    },
    then(resolve: (v: unknown) => unknown) {
      serviceCalls.push({ method: 'then' })
      // Mimic the real `.update().eq().then()` chain resolving to an array.
      return Promise.resolve({ data: null, error: null }).then(resolve)
    },
  }
  return chain
}

const fakeServerSupabase = { from: vi.fn(() => makeServerChain()) }
const fakeServiceSupabase = {
  from: vi.fn((table: string) => {
    serviceCalls.push({ method: 'from', table })
    return makeServiceChain()
  }),
}

vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: vi.fn(async () => fakeServerSupabase),
  getServiceSupabase: vi.fn(() => fakeServiceSupabase),
}))

// ----- Mock auth guard ----------------------------------------------
let mockUser: { id: string; email: string | null } | null = null
vi.mock('@foundations/auth/guards', () => ({
  getSessionUser: vi.fn(async () => mockUser),
}))

// ----- Mock logger (capture for PII-safety assertion) ---------------
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
const { resumeSubscriptionAction } = await import('./resumeSubscription')

beforeEach(() => {
  serverCalls.length = 0
  serverQueue = []
  serviceCalls.length = 0
  revalidateCalls.length = 0
  logCalls.length = 0
  capturedUpdateParams = null
  stripeError = null
  stripeConfigured = true
  mockUser = { id: 'user-1', email: 'user@example.com' }
  fakeServerSupabase.from.mockClear()
  fakeServiceSupabase.from.mockClear()
  fakeStripe.subscriptions.update.mockClear()
})

afterEach(() => {
  vi.clearAllMocks()
})

// ===================================================================
// Input validation
// ===================================================================

describe('resumeSubscriptionAction — input validation', () => {
  it('accepts an empty object (no fields required in v1)', async () => {
    serverQueue.push({
      data: {
        id: 'sub-1',
        stripe_subscription_id: 'sub_stripe_1',
        cancel_at_period_end: true,
        current_period_end: new Date(Date.now() + 86400000).toISOString(),
        status: 'active',
      },
      error: null,
    })

    const res = await resumeSubscriptionAction({})
    expect(res.ok).toBe(true)
  })

  it('accepts a FormData-shaped input as well (forms post to server actions)', async () => {
    serverQueue.push({
      data: {
        id: 'sub-1',
        stripe_subscription_id: 'sub_stripe_1',
        cancel_at_period_end: true,
        current_period_end: new Date(Date.now() + 86400000).toISOString(),
        status: 'active',
      },
      error: null,
    })

    const fd = new FormData()
    const res = await resumeSubscriptionAction(fd)
    expect(res.ok).toBe(true)
  })
})

// ===================================================================
// Auth gating
// ===================================================================

describe('resumeSubscriptionAction — auth gating', () => {
  it('returns an auth error when no user is signed in', async () => {
    mockUser = null

    const res = await resumeSubscriptionAction({})
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/sign in/i)

    // No DB call, no Stripe call when unauthed.
    expect(fakeServerSupabase.from).not.toHaveBeenCalled()
    expect(fakeServiceSupabase.from).not.toHaveBeenCalled()
    expect(fakeStripe.subscriptions.update).not.toHaveBeenCalled()
  })
})

// ===================================================================
// Subscription lookup edge cases
// ===================================================================

describe('resumeSubscriptionAction — subscription lookup', () => {
  it('returns "No subscription found." when the user has no row', async () => {
    serverQueue.push({ data: null, error: null })

    const res = await resumeSubscriptionAction({})
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/no subscription/i)

    expect(fakeStripe.subscriptions.update).not.toHaveBeenCalled()
    expect(fakeServiceSupabase.from).not.toHaveBeenCalled()
  })
})

// ===================================================================
// Idempotency — already-resumed short-circuit
// ===================================================================

describe('resumeSubscriptionAction — idempotency', () => {
  it('short-circuits with wasScheduled=false when cancel_at_period_end is already false', async () => {
    serverQueue.push({
      data: {
        id: 'sub-1',
        stripe_subscription_id: 'sub_stripe_1',
        cancel_at_period_end: false,
        current_period_end: new Date(Date.now() + 86400000).toISOString(),
        status: 'active',
      },
      error: null,
    })

    const res = await resumeSubscriptionAction({})
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.wasScheduled).toBe(false)

    // Critical idempotency assertion: no Stripe call, no DB write.
    expect(fakeStripe.subscriptions.update).not.toHaveBeenCalled()
    expect(fakeServiceSupabase.from).not.toHaveBeenCalled()
  })
})

// ===================================================================
// Period-end guard
// ===================================================================

describe('resumeSubscriptionAction — period-end guard', () => {
  it('refuses to resume when the period has already ended', async () => {
    serverQueue.push({
      data: {
        id: 'sub-1',
        stripe_subscription_id: 'sub_stripe_1',
        cancel_at_period_end: true,
        // 1 day ago — period has ended.
        current_period_end: new Date(Date.now() - 86400000).toISOString(),
        status: 'canceled',
      },
      error: null,
    })

    const res = await resumeSubscriptionAction({})
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/ended.*start a new one/i)

    expect(fakeStripe.subscriptions.update).not.toHaveBeenCalled()
    expect(fakeServiceSupabase.from).not.toHaveBeenCalled()
  })
})

// ===================================================================
// Stripe-unconfigured path (DB-only update)
// ===================================================================

describe('resumeSubscriptionAction — Stripe unconfigured', () => {
  it('updates the local row directly when STRIPE_SECRET_KEY is empty', async () => {
    stripeConfigured = false
    serverQueue.push({
      data: {
        id: 'sub-1',
        stripe_subscription_id: 'sub_stripe_1',
        cancel_at_period_end: true,
        current_period_end: new Date(Date.now() + 86400000).toISOString(),
        status: 'active',
      },
      error: null,
    })

    const res = await resumeSubscriptionAction({})
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.wasScheduled).toBe(true)

    // Stripe was NOT called.
    expect(fakeStripe.subscriptions.update).not.toHaveBeenCalled()
    // DB WAS updated.
    expect(fakeServiceSupabase.from).toHaveBeenCalledWith('subscriptions')
    const updateCall = serviceCalls.find((c) => c.method === 'update')
    expect(updateCall).toBeDefined()
    if (updateCall && updateCall.method === 'update') {
      const body = updateCall.payload as Record<string, unknown>
      expect(body.cancel_at_period_end).toBe(false)
      expect(typeof body.updated_at).toBe('string')
    }
    const eqCall = serviceCalls.find((c) => c.method === 'eq')
    expect(eqCall).toBeDefined()
    if (eqCall && eqCall.method === 'eq') {
      expect(eqCall.col).toBe('id')
      expect(eqCall.val).toBe('sub-1')
    }
    // revalidatePath called.
    expect(revalidateCalls).toContain('/account/subscriptions')
  })

  it('updates the local row directly when stripe_subscription_id is null', async () => {
    serverQueue.push({
      data: {
        id: 'sub-1',
        stripe_subscription_id: null,
        cancel_at_period_end: true,
        current_period_end: new Date(Date.now() + 86400000).toISOString(),
        status: 'active',
      },
      error: null,
    })

    const res = await resumeSubscriptionAction({})
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.wasScheduled).toBe(true)

    expect(fakeStripe.subscriptions.update).not.toHaveBeenCalled()
    expect(fakeServiceSupabase.from).toHaveBeenCalledWith('subscriptions')
  })
})

// ===================================================================
// Happy path — Stripe configured
// ===================================================================

describe('resumeSubscriptionAction — happy path (Stripe configured)', () => {
  function setupScheduledSub() {
    serverQueue.push({
      data: {
        id: 'sub-1',
        stripe_subscription_id: 'sub_stripe_1',
        cancel_at_period_end: true,
        current_period_end: new Date(Date.now() + 86400000).toISOString(),
        status: 'active',
      },
      error: null,
    })
  }

  it('calls stripe.subscriptions.update with cancel_at_period_end: false', async () => {
    setupScheduledSub()

    const res = await resumeSubscriptionAction({})
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.wasScheduled).toBe(true)

    expect(capturedUpdateParams).not.toBeNull()
    expect(capturedUpdateParams!.id).toBe('sub_stripe_1')
    const body = capturedUpdateParams!.body as Record<string, unknown>
    expect(body.cancel_at_period_end).toBe(false)
  })

  it('passes an idempotency key from idempotencyKey("sub_resume", sub.id)', async () => {
    setupScheduledSub()

    const res = await resumeSubscriptionAction({})
    expect(res.ok).toBe(true)

    // The 3rd arg to stripe.subscriptions.update is the opts object
    // which carries the idempotencyKey.
    const opts = capturedUpdateParams!.opts as Record<string, unknown>
    expect(opts).not.toBeNull()
    expect(typeof opts.idempotencyKey).toBe('string')
    expect((opts.idempotencyKey as string).startsWith('sub_resume:')).toBe(true)
  })

  it('mirrors the change to the local subscriptions row after Stripe succeeds', async () => {
    setupScheduledSub()

    const res = await resumeSubscriptionAction({})
    expect(res.ok).toBe(true)

    // The single service from() call is the mirror update.
    expect(fakeServiceSupabase.from).toHaveBeenCalledWith('subscriptions')
    const updateCall = serviceCalls.find((c) => c.method === 'update')
    expect(updateCall).toBeDefined()
    if (updateCall && updateCall.method === 'update') {
      const body = updateCall.payload as Record<string, unknown>
      expect(body.cancel_at_period_end).toBe(false)
    }
  })

  it('revalidates /account/subscriptions after the happy path', async () => {
    setupScheduledSub()

    await resumeSubscriptionAction({})

    expect(revalidateCalls).toContain('/account/subscriptions')
  })
})

// ===================================================================
// Stripe error handling
// ===================================================================

describe('resumeSubscriptionAction — Stripe error', () => {
  it('returns the typed error message and does NOT mirror the local row', async () => {
    // When the wrapper returns ok:false (the typed-error path), the
    // action passes the wrapper's classifier message through verbatim
    // and bails before the local mirror update. Stripe remains the
    // source of truth for cancel_at_period_end, so a failed resume
    // leaves the local row in sync (still canceled-at-period-end).
    serverQueue.push({
      data: {
        id: 'sub-1',
        stripe_subscription_id: 'sub_stripe_1',
        cancel_at_period_end: true,
        current_period_end: new Date(Date.now() + 86400000).toISOString(),
        status: 'active',
      },
      error: null,
    })
    // Force the wrapper to return ok:false (the typed-error path).
    stripeError = new Error('stripe_api_error: subscription not found')

    const res = await resumeSubscriptionAction({})
    expect(res.ok).toBe(false)
    if (!res.ok) {
      // The action returns result.message verbatim on the typed-error
      // path (this is by design — the wrapper's classifier message is
      // already user-safe; re-wrapping it would be a lie).
      expect(res.error).toBe('stripe_api_error: subscription not found')
    }

    // DB was NOT updated — Stripe rejected, so we keep the local
    // mirror in sync with Stripe (still canceled-at-period-end).
    expect(fakeServiceSupabase.from).not.toHaveBeenCalled()
  })

  it('typed-error path does NOT emit a warn log (wrapper already logged it)', async () => {
    // The catch-block warning only fires when the wrapper itself
    // throws (an unexpected error class). On the typed-error path, the
    // wrapper has already logged the classified error with a typed
    // `code` — a second warn call would double-log. The action
    // returns the wrapper's message without re-logging.
    serverQueue.push({
      data: {
        id: 'sub-1',
        stripe_subscription_id: 'sub_stripe_1',
        cancel_at_period_end: true,
        current_period_end: new Date(Date.now() + 86400000).toISOString(),
        status: 'active',
      },
      error: null,
    })
    stripeError = new Error('card_declined')

    await resumeSubscriptionAction({})

    const warns = logCalls.filter((l) => l.level === 'warn')
    expect(warns).toHaveLength(0)
  })

  it('returns the catch-all error message when the wrapper itself throws', async () => {
    // If the Stripe wrapper itself throws (a bug, a network blip
    // outside the classifier), the catch-block fires with a
    // PII-safe message ("Could not resume. Try again or contact
    // support.") — not the raw exception text. This is the second
    // safety net behind the classifier.
    serverQueue.push({
      data: {
        id: 'sub-1',
        stripe_subscription_id: 'sub_stripe_1',
        cancel_at_period_end: true,
        current_period_end: new Date(Date.now() + 86400000).toISOString(),
        status: 'active',
      },
      error: null,
    })
    // Make the wrapper itself throw — bypass the wrapper's try/catch
    // by making getStripe throw on access. The mock returns a function
    // we control: we wrap the mock to throw instead.
    const stripeMod = await import('@foundations/money/stripe')
    vi.mocked(stripeMod.getStripe).mockImplementationOnce(() => {
      throw new Error('Stripe SDK initialization failed')
    })

    const res = await resumeSubscriptionAction({})
    expect(res.ok).toBe(false)
    if (!res.ok) {
      // Catch-all path returns the user-safe fallback, NOT the raw
      // exception text (which could leak Stripe internals).
      expect(res.error).toBe('Could not resume. Try again or contact support.')
    }

    const warn = logCalls.find((l) => l.level === 'warn')
    expect(warn).toBeDefined()
    if (warn) {
      const payload = warn.payload as Record<string, unknown>
      const json = JSON.stringify(payload)
      // PII safety: code + msg only, no email, no stripe IDs.
      expect(json).not.toMatch(/user@example\.com/)
      expect(json).not.toMatch(/cus_/)
      expect(json).not.toMatch(/sk_/)
      expect(json).not.toMatch(/password/i)
      expect(typeof payload.code).toBe('string')
    }
  })
})

// ===================================================================
// PII safety — happy-path log
// ===================================================================

describe('resumeSubscriptionAction — PII safety on happy path', () => {
  it('log line carries user_id + subscription_id UUIDs only', async () => {
    serverQueue.push({
      data: {
        id: 'sub-1',
        stripe_subscription_id: 'sub_stripe_1',
        cancel_at_period_end: true,
        current_period_end: new Date(Date.now() + 86400000).toISOString(),
        status: 'active',
      },
      error: null,
    })

    await resumeSubscriptionAction({})

    const info = logCalls.find((l) => l.level === 'info')
    expect(info).toBeDefined()
    if (info) {
      const payload = info.payload as Record<string, unknown>
      const json = JSON.stringify(payload)
      // No email, no stripe IDs, no tokens, no password.
      expect(json).not.toMatch(/user@example\.com/)
      expect(json).not.toMatch(/cus_/)
      expect(json).not.toMatch(/sk_/)
      expect(json).not.toMatch(/password/i)
      // Carries the UUIDs for ops correlation.
      expect(payload.user_id).toBe('user-1')
      expect(payload.subscription_id).toBe('sub-1')
    }
  })
})
