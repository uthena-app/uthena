// onRefund.test.ts — unit tests for the Stripe `charge.refunded`
// webhook handler in `02-features/checkout/actions/onRefund.ts`.
//
// Covers (P6.9 royalty engine audit):
//   - **Missing `payment_intent`**: returns `{ ok: false, error: 'missing payment_intent' }`.
//   - **Order not found by payment_intent**: returns `{ ok: false, error: 'order not found' }`.
//   - **Idempotency**: re-delivery with the same `stripe_refund_id` returns early.
//   - **Refund insert failure**: returns `{ ok: false, error: 'refund insert failed' }`.
//   - **Order update math**: `refunded_cents` accumulates + status flips
//     to `refunded` (full) or `partially_refunded` (partial).
//   - **library_grants UPDATE**: predicate is `order_id = $1`, `revoked_at`
//     is set, `revoked_reason='refund'`.
//   - **Snapshot invariant**: refund ledger row uses snapshotted
//     `royalty_cents` from `order_items` with `amount_cents = -royalty_cents`.
//   - **Multi-item**: one refund row per order_item.
//   - **BUG #1 (partial refund math) — documents current behavior**: a
//     $25 partial refund on a $100 order claws back the FULL $15
//     royalty (NOT $3.75 proportional). The test asserts the BUG so
//     that fixing the bug is a deliberate test change (not silent).
//   - **BUG #2 (currency mismatch) — documents current behavior**: the
//     refund row's `currency` is hardcoded to 'USD'. The test asserts
//     the BUG so the fix is mechanical.
//   - **Empty items list**: no ledger rows written, no crash.
//   - **Missing `amount` on the Stripe event**: treated as 0 (the
//     refund row will be 0 cents, the order status stays whatever it was).
//
// Queue-alignment note: the mock returns `{data: null, error: null}` by
// default from `.then()`, so tests only need to enqueue for the reads
// that return data (orders, refunds idempotency check, order_items,
// refunds re-lookup) and any insert/update they want to assert the
// error path on.
//
// Strategy: vi.mock the service-role Supabase client (chainable fake
// with terminalQueue for ordered reads + insert/update capture), the
// logger. Capture the FROM chain + INSERT payloads so we can assert the
// snapshot invariant at PR time.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ----- Mocks ---------------------------------------------------------------

type Call =
  | { method: 'from'; table: string }
  | { method: 'select'; payload: unknown }
  | { method: 'eq'; col: string; val: unknown }
  | { method: 'is'; col: string; val: unknown }
  | { method: 'maybeSingle' }
  | { method: 'single' }
  | { method: 'then' }
  | { method: 'update'; payload: unknown }
  | { method: 'insert'; payload: unknown }

const serviceCalls: Call[] = []
let serviceQueue: Array<{ data: unknown; error: unknown }> = []

// Captured refund row inserts (the `refunds` table write).
const refundInserts: Array<Record<string, unknown>> = []
// Captured ledger inserts.
const ledgerInserts: Array<Record<string, unknown>> = []
// Captured order updates.
const ordersUpdates: Array<Record<string, unknown>> = []
// Captured library_grants updates.
const grantUpdates: Array<{ payload: unknown; eqArgs: Array<{ col: string; val: unknown }>; isArgs: Array<{ col: string; val: unknown }> }> = []

function makeChain() {
  const eqArgs: Array<{ col: string; val: unknown }> = []
  const isArgs: Array<{ col: string; val: unknown }> = []
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
    is(col: string, val: unknown) {
      serviceCalls.push({ method: 'is', col, val })
      isArgs.push({ col, val })
      return chain
    },
    maybeSingle: vi.fn(async () => {
      serviceCalls.push({ method: 'maybeSingle' })
      return serviceQueue.shift() ?? { data: null, error: null }
    }),
    single: vi.fn(async () => {
      serviceCalls.push({ method: 'single' })
      return serviceQueue.shift() ?? { data: null, error: null }
    }),
    update(payload: unknown) {
      serviceCalls.push({ method: 'update', payload })
      // If the chain is orders or library_grants, capture the shape.
      const lastFrom = [...serviceCalls].reverse().find((c) => c.method === 'from')
      const table = lastFrom && lastFrom.method === 'from' ? lastFrom.table : ''
      if (table === 'library_grants') {
        grantUpdates.push({ payload, eqArgs: [...eqArgs], isArgs: [...isArgs] })
      } else if (table === 'orders') {
        if (Array.isArray(payload)) {
          for (const p of payload) ordersUpdates.push(p as Record<string, unknown>)
        } else {
          ordersUpdates.push(payload as Record<string, unknown>)
        }
      }
      return chain
    },
    insert(payload: unknown) {
      serviceCalls.push({ method: 'insert', payload })
      const lastFrom = [...serviceCalls].reverse().find((c) => c.method === 'from')
      const table = lastFrom && lastFrom.method === 'from' ? lastFrom.table : ''
      const arr = Array.isArray(payload) ? payload : [payload]
      for (const row of arr) {
        const r = row as Record<string, unknown>
        if (table === 'refunds') {
          refundInserts.push(r)
        } else if (table === 'payout_ledger') {
          ledgerInserts.push(r)
        }
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
  refundInserts.length = 0
  ledgerInserts.length = 0
  ordersUpdates.length = 0
  grantUpdates.length = 0
  logCalls.length = 0
  vi.clearAllMocks()
}

function enqueue(data: unknown, error: unknown = null): void {
  serviceQueue.push({ data, error })
}

/**
 * Stage the queue for the full happy-path flow in `onRefund`.
 *
 * Source consumption order (every `await` consumes ONE queue item via
 * the mock's `.then()`/`.maybeSingle()`):
 *   1. orders lookup (maybeSingle) → order row (includes total_cents, refunded_cents, currency)
 *   2. refunds idempotency check (maybeSingle) → null (no existing)
 *   3. refunds.insert (then) → null (success)
 *   4. orders UPDATE (then) → null (success)
 *   5. library_grants UPDATE (then) → null (success)
 *   6. order_items read (then) → items[]
 *   7. refunds re-lookup (maybeSingle) → refund id
 *   8. payout_ledger.insert (then) → null (success)
 *
 * Total queue entries: 8.
 */
function stageOnRefund(opts: {
  order: unknown
  items: unknown
  refundId?: number | null
  ordersUpdateError?: unknown
  libraryGrantsUpdateError?: unknown
  refundIdempotencyExisting?: unknown
}) {
  // 1. orders lookup (maybeSingle)
  enqueue(opts.order)
  // 2. refunds idempotency check (maybeSingle)
  enqueue(opts.refundIdempotencyExisting ?? null)
  // 3. refunds.insert (then)
  enqueue(null)
  // 4. orders UPDATE (then)
  enqueue(opts.ordersUpdateError ? null : null, opts.ordersUpdateError ?? null)
  // 5. library_grants UPDATE (then)
  enqueue(opts.libraryGrantsUpdateError ? null : null, opts.libraryGrantsUpdateError ?? null)
  // 6. order_items read (then)
  enqueue(opts.items)
  // 7. refunds re-lookup (maybeSingle)
  enqueue({ id: opts.refundId ?? 500 })
  // 8. payout_ledger.insert (then)
  enqueue(null)
}

// ----- Tests ---------------------------------------------------------------

describe('onRefund — fatal guards', () => {
  beforeEach(resetAll)
  afterEach(resetAll)

  it('returns error when payment_intent is missing', async () => {
    const { onRefund } = await import('./onRefund')

    const result = await onRefund({
      id: 're_test_nopi',
      payment_intent: null,
      amount: 5000,
      metadata: {},
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('missing payment_intent')
    // No DB calls.
    expect(refundInserts).toHaveLength(0)
    expect(ledgerInserts).toHaveLength(0)
  })

  it('returns error when order cannot be found by payment_intent', async () => {
    const { onRefund } = await import('./onRefund')

    enqueue(null) // order lookup → null

    const result = await onRefund({
      id: 're_test_orphan',
      payment_intent: 'pi_orphan',
      amount: 5000,
      metadata: {},
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('order not found')
    // No refund insert, no ledger insert.
    expect(refundInserts).toHaveLength(0)
    expect(ledgerInserts).toHaveLength(0)
  })
})

describe('onRefund — idempotency', () => {
  beforeEach(resetAll)
  afterEach(resetAll)

  it('returns ok with no side effects when stripe_refund_id already exists', async () => {
    const { onRefund } = await import('./onRefund')

    // Queue: orders lookup → order exists
    enqueue({ id: 50, user_id: 'u_1', status: 'paid' })
    // Queue: refunds lookup → existing refund row
    enqueue({ id: 999 })

    const result = await onRefund({
      id: 're_test_idempotent',
      payment_intent: 'pi_50',
      amount: 5000,
      metadata: {},
    })

    expect(result.ok).toBe(true)
    // No refund insert, no ledger insert — short-circuit.
    expect(refundInserts).toHaveLength(0)
    expect(ledgerInserts).toHaveLength(0)
  })
})

describe('onRefund — happy path (snapshot invariant + multi-item)', () => {
  beforeEach(resetAll)
  afterEach(resetAll)

  it('inserts refunds row + flips order to refunded + revokes grants + writes negative ledger rows', async () => {
    const { onRefund } = await import('./onRefund')

    stageOnRefund({
      order: { id: 100, user_id: 'u_1', status: 'paid', total_cents: 10000, refunded_cents: 0, currency: 'USD' },
      items: [
        { id: 1000, partner_id: 7, royalty_cents: 1500, royalty_pct_bps: 1500 },
        { id: 1001, partner_id: 8, royalty_cents: 2000, royalty_pct_bps: 1500 },
      ],
      refundId: 500,
    })

    const result = await onRefund({
      id: 're_test_happy',
      payment_intent: 'pi_100',
      amount: 10000,
      metadata: {},
    })

    expect(result.ok).toBe(true)
    // Refunds row shape.
    expect(refundInserts).toHaveLength(1)
    expect(refundInserts[0]!.order_id).toBe(100)
    expect(refundInserts[0]!.amount_cents).toBe(10000)
    expect(refundInserts[0]!.status).toBe('succeeded')
    expect(refundInserts[0]!.stripe_refund_id).toBe('re_test_happy')
    // Order update: status='refunded' (full refund, refunded_cents = total_cents).
    expect(ordersUpdates).toHaveLength(1)
    expect(ordersUpdates[0]!.status).toBe('refunded')
    expect(ordersUpdates[0]!.refunded_cents).toBe(10000)
    // Library grants UPDATE: predicate is order_id, revoked_at not null.
    expect(grantUpdates).toHaveLength(1)
    const grantUpdate = grantUpdates[0]!
    expect(grantUpdate.payload).toEqual({ revoked_at: expect.any(String), revoked_reason: 'refund' })
    // The eqArgs/isArgs are captured at the time of .update() call, so
    // the chain is built BEFORE the .eq().is() calls fire. We assert
    // the eq/is calls were issued in `serviceCalls` instead.
    const eqCalls = serviceCalls.filter((c) => c.method === 'eq') as Array<{ col: string; val: unknown }>
    const isCalls = serviceCalls.filter((c) => c.method === 'is') as Array<{ col: string; val: unknown }>
    expect(eqCalls.some((e) => e.col === 'order_id' && e.val === 100)).toBe(true)
    expect(isCalls.some((i) => i.col === 'revoked_at' && i.val === null)).toBe(true)
    // Ledger rows: 2 rows (one per order_item) with negative royalty.
    expect(ledgerInserts).toHaveLength(2)
    expect(ledgerInserts[0]!.amount_cents).toBe(-1500)
    expect(ledgerInserts[0]!.kind).toBe('refund')
    expect(ledgerInserts[0]!.status).toBe('accruing')
    expect(ledgerInserts[0]!.partner_id).toBe(7)
    expect(ledgerInserts[0]!.order_id).toBe(100)
    expect(ledgerInserts[0]!.order_item_id).toBe(1000)
    expect(ledgerInserts[0]!.refund_id).toBe(500)
    expect(ledgerInserts[1]!.amount_cents).toBe(-2000)
    expect(ledgerInserts[1]!.partner_id).toBe(8)
    expect(ledgerInserts[1]!.order_item_id).toBe(1001)
  })

  it('flips order to partially_refunded when refund_amount < total_cents', async () => {
    const { onRefund } = await import('./onRefund')

    stageOnRefund({
      order: { id: 101, user_id: 'u_1', status: 'paid', total_cents: 10000, refunded_cents: 0, currency: 'USD' },
      items: [],
      refundId: 501,
    })

    const result = await onRefund({
      id: 're_test_partial',
      payment_intent: 'pi_101',
      amount: 2500, // $25 partial
      metadata: {},
    })

    expect(result.ok).toBe(true)
    expect(ordersUpdates).toHaveLength(1)
    expect(ordersUpdates[0]!.status).toBe('partially_refunded')
    expect(ordersUpdates[0]!.refunded_cents).toBe(2500)
  })

  it('accumulates refunded_cents across multiple refund events (refunded_cents += amount)', async () => {
    const { onRefund } = await import('./onRefund')

    stageOnRefund({
      order: { id: 102, user_id: 'u_1', status: 'partially_refunded', total_cents: 10000, refunded_cents: 2500, currency: 'USD' },
      items: [],
      refundId: 502,
    })

    const result = await onRefund({
      id: 're_test_accum',
      payment_intent: 'pi_102',
      amount: 7500, // completes the refund
      metadata: {},
    })

    expect(result.ok).toBe(true)
    expect(ordersUpdates[0]!.refunded_cents).toBe(10000) // 2500 + 7500
    expect(ordersUpdates[0]!.status).toBe('refunded')
  })
})

describe('onRefund — snapshot invariant (P6.9)', () => {
  beforeEach(resetAll)
  afterEach(resetAll)

  it('refund ledger row uses snapshotted royalty_cents from order_items, not live partner lookup', async () => {
    const { onRefund } = await import('./onRefund')

    stageOnRefund({
      order: { id: 200, user_id: 'u_1', status: 'paid', total_cents: 10000, refunded_cents: 0, currency: 'USD' },
      items: [{ id: 2000, partner_id: 7, royalty_cents: 1500, royalty_pct_bps: 1500 }],
      refundId: 600,
    })
    enqueue({ id: 600 })

    await onRefund({
      id: 're_test_snap',
      payment_intent: 'pi_200',
      amount: 10000,
      metadata: {},
    })

    expect(ledgerInserts).toHaveLength(1)
    // The snapshot: order_items.royalty_cents=1500 → amount_cents=-1500.
    expect(ledgerInserts[0]!.amount_cents).toBe(-1500)
    // Sanity: kind + status reflect the refund shape.
    expect(ledgerInserts[0]!.kind).toBe('refund')
    expect(ledgerInserts[0]!.status).toBe('accruing')
    expect(ledgerInserts[0]!.order_item_id).toBe(2000)
  })
})

describe('onRefund — proportional refund math (ADR-0009 fix)', () => {
  // These tests assert the FIXED behavior of the proportional refund
  // math + currency propagation + royalty_pct_bps snapshot that landed
  // in the P6.9 cycle. See docs/ROYALTY-ENGINE-AUDIT.md for context.

  beforeEach(resetAll)
  afterEach(resetAll)

  it('partial refund claws back PROPORTIONAL royalty (50% refund of $100 order → 50% of $15 royalty = -$7.50)', async () => {
    // Scenario: $100 order (royalty $15 = 1500 cents), $50 partial refund.
    // Correct behavior: clawback = $15 × (50/100) = $7.50 = 750 cents.
    const { onRefund } = await import('./onRefund')

    stageOnRefund({
      order: { id: 300, user_id: 'u_1', status: 'paid', total_cents: 10000, refunded_cents: 0, currency: 'USD' },
      items: [{ id: 3000, partner_id: 7, royalty_cents: 1500, royalty_pct_bps: 1500 }],
      refundId: 700,
    })

    const result = await onRefund({
      id: 're_test_partial_50',
      payment_intent: 'pi_300',
      amount: 5000, // $50 partial
      metadata: {},
    })

    expect(result.ok).toBe(true)
    expect(ledgerInserts).toHaveLength(1)
    // Proportional clawback: 50% of 1500 cents = 750 cents, signed negative.
    expect(ledgerInserts[0]!.amount_cents).toBe(-750)
  })

  it('partial refund (25%) claws back QUARTER of royalty ($-3.75)', async () => {
    const { onRefund } = await import('./onRefund')

    stageOnRefund({
      order: { id: 300, user_id: 'u_1', status: 'paid', total_cents: 10000, refunded_cents: 0, currency: 'USD' },
      items: [{ id: 3000, partner_id: 7, royalty_cents: 1500, royalty_pct_bps: 1500 }],
      refundId: 700,
    })

    const result = await onRefund({
      id: 're_test_partial_25',
      payment_intent: 'pi_300',
      amount: 2500, // $25 partial
      metadata: {},
    })

    expect(result.ok).toBe(true)
    expect(ledgerInserts[0]!.amount_cents).toBe(-375)
  })

  it('partial refund clamps at full royalty when refund exceeds proportional share', async () => {
    // Defensive: a refund larger than the order shouldn't over-claw.
    // (E.g. $200 refund on $100 order would be 200% — clamped to 100%.)
    const { onRefund } = await import('./onRefund')

    stageOnRefund({
      order: { id: 300, user_id: 'u_1', status: 'paid', total_cents: 10000, refunded_cents: 0, currency: 'USD' },
      items: [{ id: 3000, partner_id: 7, royalty_cents: 1500, royalty_pct_bps: 1500 }],
      refundId: 700,
    })

    const result = await onRefund({
      id: 're_test_overrefund',
      payment_intent: 'pi_300',
      amount: 20000, // $200 (more than the $100 order — bad input but defensive)
      metadata: {},
    })

    expect(result.ok).toBe(true)
    // Clamped at full royalty: -1500, not -3000.
    expect(ledgerInserts[0]!.amount_cents).toBe(-1500)
  })

  it('refund ledger row currency is propagated from order.currency (EUR stays EUR)', async () => {
    // Multi-currency catalogs: the refund row must match the order's
    // currency or the partner's per-currency aggregates diverge.
    const { onRefund } = await import('./onRefund')

    stageOnRefund({
      order: { id: 301, user_id: 'u_1', status: 'paid', total_cents: 10000, refunded_cents: 0, currency: 'EUR' },
      items: [{ id: 3001, partner_id: 7, royalty_cents: 1500, royalty_pct_bps: 1500 }],
      refundId: 701,
    })

    const result = await onRefund({
      id: 're_test_currency_eur',
      payment_intent: 'pi_301',
      amount: 10000,
      metadata: {},
    })

    expect(result.ok).toBe(true)
    expect(ledgerInserts).toHaveLength(1)
    expect(ledgerInserts[0]!.currency).toBe('EUR')
  })

  it('refund ledger row carries the snapshotted royalty_pct_bps from order_items', async () => {
    // Audit trail: the refund row's royalty_pct_bps proves "this refund
    // was computed at X%". Matches the original sale row's shape.
    const { onRefund } = await import('./onRefund')

    stageOnRefund({
      order: { id: 302, user_id: 'u_1', status: 'paid', total_cents: 10000, refunded_cents: 0, currency: 'USD' },
      items: [{ id: 3002, partner_id: 7, royalty_cents: 1500, royalty_pct_bps: 1500 }],
      refundId: 702,
    })

    const result = await onRefund({
      id: 're_test_bps_snapshot',
      payment_intent: 'pi_302',
      amount: 5000,
      metadata: {},
    })

    expect(result.ok).toBe(true)
    expect(ledgerInserts[0]!.royalty_pct_bps).toBe(1500)
  })
})

describe('onRefund — edge cases', () => {
  beforeEach(resetAll)
  afterEach(resetAll)

  it('handles missing Stripe amount (treated as 0 cents)', async () => {
    const { onRefund } = await import('./onRefund')

    stageOnRefund({
      order: { id: 400, user_id: 'u_1', status: 'paid', total_cents: 10000, refunded_cents: 0, currency: 'USD' },
      items: [],
      refundId: 800,
    })

    const result = await onRefund({
      id: 're_test_noamount',
      payment_intent: 'pi_400',
      // amount deliberately missing
      amount: null,
      metadata: {},
    })

    expect(result.ok).toBe(true)
    expect(refundInserts).toHaveLength(1)
    expect(refundInserts[0]!.amount_cents).toBe(0)
    // Order update: 0 + 0 = 0, not >= total_cents, so partially_refunded.
    expect(ordersUpdates).toHaveLength(1)
    expect(ordersUpdates[0]!.status).toBe('partially_refunded')
    expect(ordersUpdates[0]!.refunded_cents).toBe(0)
    // No ledger rows (empty items list).
    expect(ledgerInserts).toHaveLength(0)
  })

  it('handles empty order_items (no ledger rows, no crash)', async () => {
    const { onRefund } = await import('./onRefund')

    stageOnRefund({
      order: { id: 401, user_id: 'u_1', status: 'paid', total_cents: 10000, refunded_cents: 0, currency: 'USD' },
      items: [],
      refundId: 801,
    })

    const result = await onRefund({
      id: 're_test_noitems',
      payment_intent: 'pi_401',
      amount: 5000,
      metadata: {},
    })

    expect(result.ok).toBe(true)
    expect(ledgerInserts).toHaveLength(0)
    // Order is still updated.
    expect(ordersUpdates).toHaveLength(1)
    expect(ordersUpdates[0]!.status).toBe('partially_refunded')
  })

  it('refund insert failure surfaces as error (does not silently drop)', async () => {
    const { onRefund } = await import('./onRefund')

    enqueue({ id: 500, user_id: 'u_1', status: 'paid' })
    enqueue(null)
    // refunds.insert → ERROR
    enqueue(null, { message: 'constraint violation' })

    const result = await onRefund({
      id: 're_test_insertfail',
      payment_intent: 'pi_500',
      amount: 5000,
      metadata: {},
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('refund insert failed')
    }
    // No order update, no ledger insert.
    expect(ordersUpdates).toHaveLength(0)
    expect(ledgerInserts).toHaveLength(0)
  })
})