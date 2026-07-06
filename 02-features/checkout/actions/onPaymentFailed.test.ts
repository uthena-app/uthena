// onPaymentFailed.test.ts — unit tests for the STUB-063 fix: Stripe
// `payment_intent.payment_failed` / `checkout.session.expired` /
// `checkout.session.async_payment_failed` webhook handler in
// `02-features/checkout/actions/onPaymentFailed.ts`.
//
// Covers:
//   - **Missing identifier**: neither payment_intent_id nor
//     checkout_session_id → `{ ok: false, error: 'missing payment_intent or checkout_session id' }`.
//   - **Order resolution**: looks up by `stripe_payment_intent_id` when
//     `payment_intent_id` is given, by `stripe_checkout_session_id`
//     otherwise.
//   - **Order not found**: returns `{ ok: false, error: 'order not found' }`.
//   - **Order lookup error**: returns `{ ok: false, error: 'order lookup failed' }`.
//   - **Idempotent no-op on terminal states**: an order already 'paid'
//     / 'fulfilled' / 'refunded' / 'canceled' / etc. is left untouched
//     — returns `{ ok: true, already_terminal: true }` and performs NO
//     writes.
//   - **Cancels the order**: flips status='canceled' + sets
//     canceled_at on a non-terminal order.
//   - **Cart release**: reverts cart_items for the order's products
//     back to status='active' (filtered on user_id + product_id +
//     status<>'active').
//   - **No order_items**: no cart_items UPDATE attempted (nothing to
//     release).
//   - **Update failure**: returns `{ ok: false, error: 'order update failed' }`
//     and does NOT attempt the cart release.
//   - **Audit log best-effort**: an audit insert failure does not fail
//     the handler (order is still canceled).
//
// Strategy: same chainable-fake-with-queue pattern as onRefund.test.ts —
// vi.mock the service-role Supabase client, capture the FROM chain +
// UPDATE/INSERT payloads so assertions can target the exact table +
// shape written.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ----- Mocks ---------------------------------------------------------------

type Call =
  | { method: 'from'; table: string }
  | { method: 'select'; payload: unknown }
  | { method: 'eq'; col: string; val: unknown }
  | { method: 'neq'; col: string; val: unknown }
  | { method: 'in'; col: string; vals: unknown[] }
  | { method: 'maybeSingle' }
  | { method: 'then' }
  | { method: 'update'; payload: unknown }
  | { method: 'insert'; payload: unknown }

const serviceCalls: Call[] = []
let serviceQueue: Array<{ data: unknown; error: unknown }> = []

const ordersUpdates: Array<Record<string, unknown>> = []
const cartUpdates: Array<{ payload: Record<string, unknown>; eqArgs: Array<{ col: string; val: unknown }>; neqArgs: Array<{ col: string; val: unknown }> }> = []
const auditInserts: Array<Record<string, unknown>> = []

function currentTable(): string {
  const lastFrom = [...serviceCalls].reverse().find((c) => c.method === 'from')
  return lastFrom && lastFrom.method === 'from' ? lastFrom.table : ''
}

function makeChain() {
  const eqArgs: Array<{ col: string; val: unknown }> = []
  const neqArgs: Array<{ col: string; val: unknown }> = []
  const chain: any = {
    select(payload: unknown) {
      serviceCalls.push({ method: 'select', payload })
      return chain
    },
    eq(col: string, val: unknown) {
      serviceCalls.push({ method: 'eq', col, val })
      eqArgs.push({ col, val })
      return chain
    },
    neq(col: string, val: unknown) {
      serviceCalls.push({ method: 'neq', col, val })
      neqArgs.push({ col, val })
      return chain
    },
    in(col: string, vals: unknown[]) {
      serviceCalls.push({ method: 'in', col, vals })
      return chain
    },
    maybeSingle: vi.fn(async () => {
      serviceCalls.push({ method: 'maybeSingle' })
      return serviceQueue.shift() ?? { data: null, error: null }
    }),
    update(payload: unknown) {
      serviceCalls.push({ method: 'update', payload })
      const table = currentTable()
      if (table === 'orders') {
        ordersUpdates.push(payload as Record<string, unknown>)
      } else if (table === 'cart_items') {
        // NOTE: eqArgs/neqArgs are pushed by reference (not spread into a
        // copy) because the production chain is update().eq().in().neq() —
        // .eq()/.neq() run AFTER .update() in the fluent chain, so a spread
        // snapshot taken here would always be empty. Assertions read these
        // arrays only after the full chain (and the `await` on the handler)
        // has completed, by which point the arrays are fully populated.
        cartUpdates.push({ payload: payload as Record<string, unknown>, eqArgs, neqArgs })
      }
      return chain
    },
    insert(payload: unknown) {
      serviceCalls.push({ method: 'insert', payload })
      const table = currentTable()
      if (table === 'admin_audit_log') {
        auditInserts.push(payload as Record<string, unknown>)
      }
      return chain
    },
    then(resolve: (v: unknown) => unknown) {
      serviceCalls.push({ method: 'then' })
      const next = serviceQueue.shift() ?? { data: null, error: null }
      return Promise.resolve(next).then(resolve)
    },
  }
  return chain
}

const fakeServiceSupabase = {
  from: vi.fn((table: string) => {
    serviceCalls.push({ method: 'from', table })
    return makeChain()
  }),
}

vi.mock('@foundations/data/supabase', () => ({
  getServiceSupabase: vi.fn(() => fakeServiceSupabase),
}))

const logCalls: Array<{ level: string; payload: Record<string, unknown>; msg: string | undefined }> = []

vi.mock('@foundations/log/pino', () => ({
  loggerFor: () => ({
    info: (payload: Record<string, unknown>, msg?: string) => logCalls.push({ level: 'info', payload, msg }),
    warn: (payload: Record<string, unknown>, msg?: string) => logCalls.push({ level: 'warn', payload, msg }),
    error: (payload: Record<string, unknown>, msg?: string) => logCalls.push({ level: 'error', payload, msg }),
    debug: (payload: Record<string, unknown>, msg?: string) => logCalls.push({ level: 'debug', payload, msg }),
  }),
}))

function resetAll(): void {
  serviceCalls.length = 0
  serviceQueue.length = 0
  ordersUpdates.length = 0
  cartUpdates.length = 0
  auditInserts.length = 0
  logCalls.length = 0
  vi.clearAllMocks()
}

function enqueue(data: unknown, error: unknown = null): void {
  serviceQueue.push({ data, error })
}

describe('onPaymentFailed — input validation', () => {
  beforeEach(resetAll)
  afterEach(resetAll)

  it('returns an error when neither payment_intent_id nor checkout_session_id is present', async () => {
    const { onPaymentFailed } = await import('./onPaymentFailed')
    const result = await onPaymentFailed({ event_type: 'payment_intent.payment_failed' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('missing payment_intent or checkout_session id')
    // No DB calls attempted.
    expect(serviceCalls).toHaveLength(0)
  })
})

describe('onPaymentFailed — order resolution', () => {
  beforeEach(resetAll)
  afterEach(resetAll)

  it('looks up by stripe_payment_intent_id when payment_intent_id is given', async () => {
    const { onPaymentFailed } = await import('./onPaymentFailed')
    enqueue({ id: 10, status: 'awaiting_payment', user_id: 'u_1' }) // order lookup
    enqueue(null) // orders UPDATE
    enqueue([]) // order_items (empty → no cart release)
    enqueue(null) // audit insert

    await onPaymentFailed({ event_type: 'payment_intent.payment_failed', payment_intent_id: 'pi_1' })

    const eqCall = serviceCalls.find((c) => c.method === 'eq' && c.col === 'stripe_payment_intent_id')
    expect(eqCall).toBeDefined()
  })

  it('looks up by stripe_checkout_session_id when only checkout_session_id is given', async () => {
    const { onPaymentFailed } = await import('./onPaymentFailed')
    enqueue({ id: 11, status: 'awaiting_payment', user_id: 'u_1' }) // order lookup
    enqueue(null) // orders UPDATE
    enqueue([]) // order_items
    enqueue(null) // audit insert

    await onPaymentFailed({ event_type: 'checkout.session.expired', checkout_session_id: 'cs_1' })

    const eqCall = serviceCalls.find((c) => c.method === 'eq' && c.col === 'stripe_checkout_session_id')
    expect(eqCall).toBeDefined()
  })

  it('returns error when order lookup fails', async () => {
    const { onPaymentFailed } = await import('./onPaymentFailed')
    enqueue(null, { message: 'connection lost' })

    const result = await onPaymentFailed({ event_type: 'checkout.session.expired', checkout_session_id: 'cs_x' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('order lookup failed')
  })

  it('returns error when order is not found', async () => {
    const { onPaymentFailed } = await import('./onPaymentFailed')
    enqueue(null)

    const result = await onPaymentFailed({ event_type: 'checkout.session.expired', checkout_session_id: 'cs_missing' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('order not found')
  })
})

describe('onPaymentFailed — idempotent no-op on terminal states', () => {
  beforeEach(resetAll)
  afterEach(resetAll)

  it.each(['paid', 'fulfilled', 'refunded', 'partially_refunded', 'canceled', 'failed', 'fraudulent'])(
    'does not touch an order already in terminal status=%s',
    async (status) => {
      const { onPaymentFailed } = await import('./onPaymentFailed')
      enqueue({ id: 20, status, user_id: 'u_1' })

      const result = await onPaymentFailed({ event_type: 'payment_intent.payment_failed', payment_intent_id: 'pi_terminal' })

      expect(result.ok).toBe(true)
      if (result.ok) expect(result.already_terminal).toBe(true)
      expect(ordersUpdates).toHaveLength(0)
      expect(cartUpdates).toHaveLength(0)
    },
  )
})

describe('onPaymentFailed — cancels the order + releases cart lines', () => {
  beforeEach(resetAll)
  afterEach(resetAll)

  it('flips a non-terminal order to canceled with canceled_at set', async () => {
    const { onPaymentFailed } = await import('./onPaymentFailed')
    enqueue({ id: 30, status: 'awaiting_payment', user_id: 'u_1' }) // order lookup
    enqueue(null) // orders UPDATE (status='canceled')
    enqueue([{ product_id: 5 }]) // order_items
    enqueue(null) // cart_items UPDATE
    enqueue(null) // audit insert

    const result = await onPaymentFailed({ event_type: 'payment_intent.payment_failed', payment_intent_id: 'pi_30' })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.already_terminal).toBe(false)
    expect(ordersUpdates).toHaveLength(1)
    expect(ordersUpdates[0]!.status).toBe('canceled')
    expect(typeof ordersUpdates[0]!.canceled_at).toBe('string')
  })

  it('reverts cart_items for the order products back to active (filtered on user + product + status<>active)', async () => {
    const { onPaymentFailed } = await import('./onPaymentFailed')
    enqueue({ id: 31, status: 'awaiting_payment', user_id: 'u_cart' }) // order lookup
    enqueue(null) // orders UPDATE
    enqueue([{ product_id: 7 }, { product_id: 8 }, { product_id: 7 }]) // order_items (duplicate product_id deduped)
    enqueue(null) // cart_items UPDATE
    enqueue(null) // audit insert

    await onPaymentFailed({ event_type: 'checkout.session.expired', checkout_session_id: 'cs_31' })

    expect(cartUpdates).toHaveLength(1)
    expect(cartUpdates[0]!.payload.status).toBe('active')
    expect(cartUpdates[0]!.eqArgs).toContainEqual({ col: 'user_id', val: 'u_cart' })
    expect(cartUpdates[0]!.neqArgs).toContainEqual({ col: 'status', val: 'active' })
  })

  it('does not attempt a cart_items UPDATE when the order has no items', async () => {
    const { onPaymentFailed } = await import('./onPaymentFailed')
    enqueue({ id: 32, status: 'awaiting_payment', user_id: 'u_1' }) // order lookup
    enqueue(null) // orders UPDATE
    enqueue([]) // no order_items
    enqueue(null) // audit insert

    await onPaymentFailed({ event_type: 'checkout.session.expired', checkout_session_id: 'cs_32' })

    expect(cartUpdates).toHaveLength(0)
  })

  it('writes an admin_audit_log row with action=order_payment_failed', async () => {
    const { onPaymentFailed } = await import('./onPaymentFailed')
    enqueue({ id: 33, status: 'awaiting_payment', user_id: 'u_1' }) // order lookup
    enqueue(null) // orders UPDATE
    enqueue([]) // order_items
    enqueue(null) // audit insert

    await onPaymentFailed({
      event_type: 'payment_intent.payment_failed',
      payment_intent_id: 'pi_33',
      failure_message: 'Your card was declined.',
    })

    expect(auditInserts).toHaveLength(1)
    expect(auditInserts[0]!.action).toBe('order_payment_failed')
    expect(auditInserts[0]!.target_id).toBe('33')
    expect((auditInserts[0]!.metadata as Record<string, unknown>).failure_message).toBe('Your card was declined.')
  })
})

describe('onPaymentFailed — error + resilience paths', () => {
  beforeEach(resetAll)
  afterEach(resetAll)

  it('returns error when the orders UPDATE fails, and does not attempt the cart release', async () => {
    const { onPaymentFailed } = await import('./onPaymentFailed')
    enqueue({ id: 40, status: 'awaiting_payment', user_id: 'u_1' })
    enqueue(null, { message: 'db write failed' }) // orders UPDATE fails

    const result = await onPaymentFailed({ event_type: 'payment_intent.payment_failed', payment_intent_id: 'pi_40' })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('order update failed')
    expect(cartUpdates).toHaveLength(0)
  })

  it('does not fail the handler when the audit log insert throws (order still canceled)', async () => {
    const { onPaymentFailed } = await import('./onPaymentFailed')
    enqueue({ id: 41, status: 'awaiting_payment', user_id: 'u_1' }) // order lookup
    enqueue(null) // orders UPDATE
    enqueue([]) // order_items (empty → no cart release)

    // Override `from` so the admin_audit_log table's `.insert()` throws
    // synchronously (everything else still uses the normal queue-backed
    // chain).
    const originalFrom = fakeServiceSupabase.from
    fakeServiceSupabase.from = vi.fn((table: string) => {
      serviceCalls.push({ method: 'from', table })
      if (table === 'admin_audit_log') {
        return {
          insert: () => {
            throw new Error('audit db unreachable')
          },
        }
      }
      return makeChain()
    }) as never

    const result = await onPaymentFailed({ event_type: 'payment_intent.payment_failed', payment_intent_id: 'pi_41' })

    expect(result.ok).toBe(true)
    fakeServiceSupabase.from = originalFrom
  })
})
