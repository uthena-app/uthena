// onPaymentSucceeded.test.ts — unit tests for the Stripe
// `checkout.session.completed` webhook handler in
// `02-features/checkout/actions/onPaymentSucceeded.ts`.
//
// STUB-062 fix (P6.x close-out): the handler no longer loops
// order_items in Node doing separate library_grants + payout_ledger
// INSERTs after the order is already marked paid. Instead it calls the
// `mark_order_paid_and_grant` Postgres RPC
// (04-platform/migrations/0070_atomic_order_paid_rpc.sql), which does
// the paid-flip + grants + ledger rows in ONE transaction. These tests
// cover:
//
//   - **Order resolution**: prefers `session.metadata.order_id`,
//     falls back to a `stripe_checkout_session_id` lookup.
//   - **Order not found**: returns `{ ok: false, error: 'order not found' }`.
//   - **Idempotency (app-side fast path)**: when the order is already
//     `paid` / `fulfilled`, returns `{ ok: true, already_paid: true }`
//     WITHOUT calling the RPC at all.
//   - **Order lookup error**: returns `{ ok: false, error: 'order lookup failed' }`.
//   - **RPC call shape**: `mark_order_paid_and_grant` is called with
//     `p_order_id` / `p_payment_intent_id` / `p_customer_id` derived
//     from the resolved order id + the Stripe session.
//   - **RPC failure is NOT silently swallowed (the STUB-062 regression
//     test)**: when the RPC returns an error (simulating a
//     payout_ledger constraint violation that rolled back the whole
//     transaction, including the paid flip), `onPaymentSucceeded`
//     returns `{ ok: false }` — it does NOT report success, and it
//     does NOT report `already_paid: true`. This is the assertion that
//     would have caught the original bug: the old code always
//     returned `{ ok: true }` here because the order had already been
//     marked paid before the failing ledger insert.
//   - **already_paid propagation from the RPC**: the RPC's
//     `already_paid` field flows through to the result (covers the
//     RPC's own idempotent-reentry branch).
//   - **Missing `payment_intent` / `customer` in session**: passed
//     through to the RPC as `null`, not omitted.
//
// Strategy: vi.mock the service-role Supabase client (chainable fake
// for `.from()` reads + a `.rpc()` spy). No more per-item queue
// staging — the fulfillment side effects all live in the SQL function
// now, so the JS-level test only has to prove the RPC is invoked
// correctly and that its result (success or failure) propagates
// honestly.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ----- Mocks ---------------------------------------------------------------

type Call =
  | { method: 'from'; table: string }
  | { method: 'select'; payload: unknown }
  | { method: 'eq'; col: string; val: unknown }
  | { method: 'maybeSingle' }

const serviceCalls: Call[] = []
let serviceQueue: Array<{ data: unknown; error: unknown }> = []

// RPC call capture.
const rpcCalls: Array<{ fn: string; args: unknown }> = []
let rpcQueue: Array<{ data: unknown; error: unknown }> = []

function makeChain() {
  const chain: any = {
    select(payload: unknown) {
      serviceCalls.push({ method: 'select', payload })
      return chain
    },
    eq(col: string, val: unknown) {
      serviceCalls.push({ method: 'eq', col, val })
      return chain
    },
    maybeSingle: vi.fn(async () => {
      serviceCalls.push({ method: 'maybeSingle' })
      return serviceQueue.shift() ?? { data: null, error: null }
    }),
  }
  return chain
}

const fakeServiceSupabase = {
  from: vi.fn((table: string) => {
    serviceCalls.push({ method: 'from', table })
    return makeChain()
  }),
  rpc: vi.fn(async (fn: string, args: unknown) => {
    rpcCalls.push({ fn, args })
    return rpcQueue.shift() ?? { data: null, error: null }
  }),
}

vi.mock('@foundations/data/supabase', () => ({
  getServiceSupabase: vi.fn(() => fakeServiceSupabase),
}))

// ----- Logger mock ---------------------------------------------------------

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

// ----- Helpers -------------------------------------------------------------

function resetAll(): void {
  serviceCalls.length = 0
  serviceQueue.length = 0
  rpcCalls.length = 0
  rpcQueue.length = 0
  logCalls.length = 0
  vi.clearAllMocks()
}

function enqueue(data: unknown, error: unknown = null): void {
  serviceQueue.push({ data, error })
}

function enqueueRpc(data: unknown, error: unknown = null): void {
  rpcQueue.push({ data, error })
}

// ----- Tests ---------------------------------------------------------------

describe('onPaymentSucceeded — order resolution', () => {
  beforeEach(resetAll)
  afterEach(resetAll)

  it('resolves order via session.metadata.order_id when present', async () => {
    const { onPaymentSucceeded } = await import('./onPaymentSucceeded')

    enqueue({ id: 42, status: 'awaiting_payment', user_id: 'u_1', email: 'a@b.com', total_cents: 10000, currency: 'USD' })
    enqueueRpc([{ order_id: 42, already_paid: false, items_granted: 0, ledger_rows_written: 0 }])

    const result = await onPaymentSucceeded({
      id: 'cs_test_1',
      payment_intent: 'pi_test_1',
      customer: 'cus_1',
      metadata: { order_id: '42' },
      payment_status: 'paid',
    })

    expect(result.ok).toBe(true)
    // The first `from()` should be on 'orders' (metadata short-circuits
    // the stripe_checkout_session_id lookup).
    const firstFrom = serviceCalls.find((c) => c.method === 'from')
    expect(firstFrom && firstFrom.method === 'from' ? firstFrom.table : '').toBe('orders')
  })

  it('falls back to stripe_checkout_session_id lookup when metadata is missing', async () => {
    const { onPaymentSucceeded } = await import('./onPaymentSucceeded')

    // Queue 1: orders lookup by session_id → returns the order id.
    enqueue({ id: 99 })
    // Queue 2: order re-fetch by id (status check).
    enqueue({ id: 99, status: 'awaiting_payment', user_id: 'u_1', email: 'a@b.com', total_cents: 5000, currency: 'USD' })
    enqueueRpc([{ order_id: 99, already_paid: false, items_granted: 0, ledger_rows_written: 0 }])

    const result = await onPaymentSucceeded({
      id: 'cs_test_lookup',
      payment_intent: 'pi_test_2',
      customer: null,
      metadata: {},
      payment_status: 'paid',
    })

    expect(result.ok).toBe(true)
    expect(result.ok && 'order_id' in result ? result.order_id : 0).toBe(99)
  })

  it('returns error when order cannot be found via metadata or session_id', async () => {
    const { onPaymentSucceeded } = await import('./onPaymentSucceeded')

    enqueue(null)

    const result = await onPaymentSucceeded({
      id: 'cs_test_orphan',
      payment_intent: 'pi_test_orphan',
      customer: null,
      metadata: {},
      payment_status: 'paid',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('order not found')
    }
    // No RPC call should have been attempted — no order to fulfill.
    expect(rpcCalls).toHaveLength(0)
  })
})

describe('onPaymentSucceeded — idempotency (app-side fast path)', () => {
  beforeEach(resetAll)
  afterEach(resetAll)

  it('returns already_paid=true when order is already paid, WITHOUT calling the RPC', async () => {
    const { onPaymentSucceeded } = await import('./onPaymentSucceeded')

    enqueue({ id: 50, status: 'paid', user_id: 'u_1', email: 'a@b.com', total_cents: 5000, currency: 'USD' })

    const result = await onPaymentSucceeded({
      id: 'cs_test_2',
      payment_intent: 'pi_test_2',
      customer: 'cus_2',
      metadata: { order_id: '50' },
      payment_status: 'paid',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.already_paid).toBe(true)
    }
    // Short-circuited before ever reaching the RPC — this is the cheap
    // dedup path (processed_webhooks is the outer dedup; this is the
    // second line of defense, and it should never touch the DB write
    // path at all).
    expect(rpcCalls).toHaveLength(0)
  })

  it('returns already_paid=true when order is already fulfilled, WITHOUT calling the RPC', async () => {
    const { onPaymentSucceeded } = await import('./onPaymentSucceeded')

    enqueue({ id: 60, status: 'fulfilled', user_id: 'u_1', email: 'a@b.com', total_cents: 5000, currency: 'USD' })

    const result = await onPaymentSucceeded({
      id: 'cs_test_3',
      payment_intent: 'pi_test_3',
      customer: 'cus_3',
      metadata: { order_id: '60' },
      payment_status: 'paid',
    })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.already_paid).toBe(true)
    expect(rpcCalls).toHaveLength(0)
  })

  it('propagates already_paid=true from the RPC (RPC-side idempotent reentry)', async () => {
    const { onPaymentSucceeded } = await import('./onPaymentSucceeded')

    // Order is still 'awaiting_payment' from this handler's read, but a
    // concurrent delivery already flipped it inside the DB by the time
    // the RPC runs — the RPC itself detects this and reports
    // already_paid=true without re-writing anything.
    enqueue({ id: 61, status: 'awaiting_payment', user_id: 'u_1', email: 'a@b.com', total_cents: 5000, currency: 'USD' })
    enqueueRpc([{ order_id: 61, already_paid: true, items_granted: 0, ledger_rows_written: 0 }])

    const result = await onPaymentSucceeded({
      id: 'cs_test_race',
      payment_intent: 'pi_test_race',
      customer: null,
      metadata: { order_id: '61' },
      payment_status: 'paid',
    })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.already_paid).toBe(true)
  })
})

describe('onPaymentSucceeded — error paths', () => {
  beforeEach(resetAll)
  afterEach(resetAll)

  it('returns error when order lookup fails', async () => {
    const { onPaymentSucceeded } = await import('./onPaymentSucceeded')

    enqueue(null, { message: 'connection lost' })

    const result = await onPaymentSucceeded({
      id: 'cs_test_4',
      payment_intent: 'pi_test_4',
      customer: null,
      metadata: { order_id: '70' },
      payment_status: 'paid',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('order lookup failed')
    expect(rpcCalls).toHaveLength(0)
  })
})

describe('onPaymentSucceeded — STUB-062: RPC failure is NOT silently swallowed', () => {
  beforeEach(resetAll)
  afterEach(resetAll)

  it('returns ok:false when mark_order_paid_and_grant RPC errors (regression test for the silent-drop bug)', async () => {
    const { onPaymentSucceeded } = await import('./onPaymentSucceeded')

    enqueue({ id: 200, status: 'awaiting_payment', user_id: 'u_1', email: 'a@b.com', total_cents: 20000, currency: 'USD' })
    // Simulate: the RPC's payout_ledger insert hit a constraint
    // violation, so Postgres rolled back the WHOLE transaction
    // (including the paid flip) and returned an error to the client.
    enqueueRpc(null, { message: 'constraint violation on payout_ledger' })

    const result = await onPaymentSucceeded({
      id: 'cs_test_partialfail',
      payment_intent: 'pi_partialfail',
      customer: null,
      metadata: { order_id: '200' },
      payment_status: 'paid',
    })

    // THE regression assertion: before the STUB-062 fix, this scenario
    // always returned { ok: true } because the order had already been
    // marked paid in Node before the failing ledger insert — Stripe's
    // webhook dedup would then never retry, and the partner was never
    // paid. Now the RPC failure must surface as ok:false so the
    // webhook dispatcher releases the claim and Stripe retries.
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('order fulfillment failed')
    }
    // Never reports already_paid under a failure.
    expect((result as { already_paid?: boolean }).already_paid).toBeUndefined()
    // An error-level log was emitted (not just a warn) — this is a
    // launch-blocker-severity failure, not a soft "continue anyway".
    const errorForRpc = logCalls.find(
      (l) => l.level === 'error' && (l.payload as Record<string, unknown>).code === 'mark_order_paid_failed',
    )
    expect(errorForRpc).toBeDefined()
  })

  it('calls the RPC exactly once per invocation (no silent retry-and-ignore loop)', async () => {
    const { onPaymentSucceeded } = await import('./onPaymentSucceeded')

    enqueue({ id: 201, status: 'awaiting_payment', user_id: 'u_1', email: 'a@b.com', total_cents: 5000, currency: 'USD' })
    enqueueRpc(null, { message: 'db unavailable' })

    await onPaymentSucceeded({
      id: 'cs_test_once',
      payment_intent: 'pi_once',
      customer: null,
      metadata: { order_id: '201' },
      payment_status: 'paid',
    })

    expect(rpcCalls).toHaveLength(1)
  })
})

describe('onPaymentSucceeded — RPC call shape', () => {
  beforeEach(resetAll)
  afterEach(resetAll)

  it('calls mark_order_paid_and_grant with p_order_id / p_payment_intent_id / p_customer_id', async () => {
    const { onPaymentSucceeded } = await import('./onPaymentSucceeded')

    enqueue({ id: 300, status: 'awaiting_payment', user_id: 'u_1', email: 'a@b.com', total_cents: 5000, currency: 'USD' })
    enqueueRpc([{ order_id: 300, already_paid: false, items_granted: 2, ledger_rows_written: 2 }])

    await onPaymentSucceeded({
      id: 'cs_test_shape',
      payment_intent: 'pi_shape',
      customer: 'cus_shape',
      metadata: { order_id: '300' },
      payment_status: 'paid',
    })

    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0]!.fn).toBe('mark_order_paid_and_grant')
    expect(rpcCalls[0]!.args).toEqual({
      p_order_id: 300,
      p_payment_intent_id: 'pi_shape',
      p_customer_id: 'cus_shape',
      p_tax_cents: null,
      p_total_cents: null,
    })
  })

  it('passes null for missing payment_intent / customer (never omits the keys)', async () => {
    const { onPaymentSucceeded } = await import('./onPaymentSucceeded')

    enqueue({ id: 301, status: 'awaiting_payment', user_id: 'u_1', email: 'a@b.com', total_cents: 5000, currency: 'USD' })
    enqueueRpc([{ order_id: 301, already_paid: false, items_granted: 1, ledger_rows_written: 1 }])

    await onPaymentSucceeded({
      id: 'cs_test_nulls',
      payment_intent: null,
      customer: null,
      metadata: { order_id: '301' },
      payment_status: 'paid',
    })

    expect(rpcCalls[0]!.args).toEqual({
      p_order_id: 301,
      p_payment_intent_id: null,
      p_customer_id: null,
      p_tax_cents: null,
      p_total_cents: null,
    })
  })
})

describe('onPaymentSucceeded — STUB-006: Stripe Tax amount propagation', () => {
  beforeEach(resetAll)
  afterEach(resetAll)

  it('passes session.total_details.amount_tax and session.amount_total through to the RPC', async () => {
    const { onPaymentSucceeded } = await import('./onPaymentSucceeded')

    enqueue({ id: 500, status: 'awaiting_payment', user_id: 'u_1', email: 'a@b.com', total_cents: 5000, currency: 'USD' })
    enqueueRpc([{ order_id: 500, already_paid: false, items_granted: 1, ledger_rows_written: 1 }])

    await onPaymentSucceeded({
      id: 'cs_test_tax',
      payment_intent: 'pi_tax',
      customer: null,
      metadata: { order_id: '500' },
      payment_status: 'paid',
      amount_total: 5412,
      total_details: { amount_tax: 412 },
    })

    expect(rpcCalls[0]!.args).toEqual({
      p_order_id: 500,
      p_payment_intent_id: 'pi_tax',
      p_customer_id: null,
      p_tax_cents: 412,
      p_total_cents: 5412,
    })
  })

  it('passes null tax/total when total_details is absent (session created before automatic_tax, or Stripe Tax not configured)', async () => {
    const { onPaymentSucceeded } = await import('./onPaymentSucceeded')

    enqueue({ id: 501, status: 'awaiting_payment', user_id: 'u_1', email: 'a@b.com', total_cents: 5000, currency: 'USD' })
    enqueueRpc([{ order_id: 501, already_paid: false, items_granted: 1, ledger_rows_written: 1 }])

    await onPaymentSucceeded({
      id: 'cs_test_notax',
      payment_intent: 'pi_notax',
      customer: null,
      metadata: { order_id: '501' },
      payment_status: 'paid',
      // no amount_total, no total_details
    })

    expect(rpcCalls[0]!.args).toMatchObject({ p_tax_cents: null, p_total_cents: null })
  })

  it('treats amount_tax: 0 as a real (non-null) value — zero tax is still an authoritative Stripe answer', async () => {
    const { onPaymentSucceeded } = await import('./onPaymentSucceeded')

    enqueue({ id: 502, status: 'awaiting_payment', user_id: 'u_1', email: 'a@b.com', total_cents: 5000, currency: 'USD' })
    enqueueRpc([{ order_id: 502, already_paid: false, items_granted: 1, ledger_rows_written: 1 }])

    await onPaymentSucceeded({
      id: 'cs_test_zerotax',
      payment_intent: 'pi_zerotax',
      customer: null,
      metadata: { order_id: '502' },
      payment_status: 'paid',
      amount_total: 5000,
      total_details: { amount_tax: 0 },
    })

    expect(rpcCalls[0]!.args).toMatchObject({ p_tax_cents: 0, p_total_cents: 5000 })
  })
})

describe('onPaymentSucceeded — happy path result propagation', () => {
  beforeEach(resetAll)
  afterEach(resetAll)

  it('returns ok:true, already_paid:false, and logs items_granted/ledger_rows_written from the RPC', async () => {
    const { onPaymentSucceeded } = await import('./onPaymentSucceeded')

    enqueue({ id: 400, status: 'awaiting_payment', user_id: 'u_1', email: 'a@b.com', total_cents: 30000, currency: 'USD' })
    enqueueRpc([{ order_id: 400, already_paid: false, items_granted: 3, ledger_rows_written: 3 }])

    const result = await onPaymentSucceeded({
      id: 'cs_test_multi',
      payment_intent: 'pi_multi',
      customer: null,
      metadata: { order_id: '400' },
      payment_status: 'paid',
    })

    expect(result).toEqual({ ok: true, order_id: 400, already_paid: false })
    const infoLog = logCalls.find((l) => l.level === 'info' && l.msg === 'order marked paid')
    expect(infoLog).toBeDefined()
    expect(infoLog?.payload.items_granted).toBe(3)
    expect(infoLog?.payload.ledger_rows_written).toBe(3)
  })

  it('handles a scalar (non-array) RPC response shape defensively', async () => {
    const { onPaymentSucceeded } = await import('./onPaymentSucceeded')

    enqueue({ id: 401, status: 'awaiting_payment', user_id: 'u_1', email: 'a@b.com', total_cents: 5000, currency: 'USD' })
    // Some PostgREST configurations return a single object instead of
    // a 1-row array for `returns table (...)` functions — the handler
    // must not throw either way.
    enqueueRpc({ order_id: 401, already_paid: false, items_granted: 1, ledger_rows_written: 1 })

    const result = await onPaymentSucceeded({
      id: 'cs_test_scalar',
      payment_intent: 'pi_scalar',
      customer: null,
      metadata: { order_id: '401' },
      payment_status: 'paid',
    })

    expect(result).toEqual({ ok: true, order_id: 401, already_paid: false })
  })
})
