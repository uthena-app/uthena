// onDispute.test.ts — unit tests for the STUB-061 fix: Stripe
// `charge.dispute.created` / `charge.dispute.closed` webhook handlers
// in `02-features/checkout/actions/onDispute.ts`.
//
// Covers:
//   - **onDisputeCreated**:
//     - missing payment_intent → error
//     - order not found → error
//     - freezes 'locked'/'available' payout_ledger rows to
//       'pending_dispute' (filtered on order_id + status in (...))
//     - freeze update failure → error
//     - writes an audit row (payout_ledger_dispute_frozen)
//   - **onDisputeClosed — won**:
//     - reverts 'pending_dispute' rows back to 'available'
//     - writes an audit row (payout_ledger_dispute_won)
//   - **onDisputeClosed — lost (the STUB-061 money-losing case)**:
//     - idempotent: a pre-existing 'dispute'-kind ledger row for the
//       order short-circuits with ok:true and no further writes
//     - voids not-yet-paid-out rows (locked/available/pending_dispute)
//     - writes ONE negative payout_ledger row per order_item with
//       kind='dispute', amount_cents=-royalty_cents (full clawback,
//       using the order_items snapshot, never re-derived)
//     - writes an audit row (payout_ledger_dispute_lost)
//   - **onDisputeClosed — other status (e.g. warning_closed)**: no-op,
//     returns ok:true, writes nothing.
//   - **onDisputeClosed — items lookup failure**: returns
//     `{ ok: false, error: 'items lookup failed' }`.
//
// Strategy: same chainable-fake-with-queue pattern as onRefund.test.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ----- Mocks ---------------------------------------------------------------

type Call =
  | { method: 'from'; table: string }
  | { method: 'select'; payload: unknown }
  | { method: 'eq'; col: string; val: unknown }
  | { method: 'in'; col: string; vals: unknown[] }
  | { method: 'limit'; n: number }
  | { method: 'maybeSingle' }
  | { method: 'then' }
  | { method: 'update'; payload: unknown }
  | { method: 'insert'; payload: unknown }

const serviceCalls: Call[] = []
let serviceQueue: Array<{ data: unknown; error: unknown }> = []

const ledgerUpdates: Array<{ payload: Record<string, unknown>; eqArgs: Array<{ col: string; val: unknown }>; inArgs: Array<{ col: string; vals: unknown[] }> }> = []
const ledgerInserts: Array<Record<string, unknown>> = []
const auditInserts: Array<Record<string, unknown>> = []

function currentTable(): string {
  const lastFrom = [...serviceCalls].reverse().find((c) => c.method === 'from')
  return lastFrom && lastFrom.method === 'from' ? lastFrom.table : ''
}

function makeChain() {
  const eqArgs: Array<{ col: string; val: unknown }> = []
  const inArgs: Array<{ col: string; vals: unknown[] }> = []
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
    in(col: string, vals: unknown[]) {
      serviceCalls.push({ method: 'in', col, vals })
      inArgs.push({ col, vals })
      return chain
    },
    limit(n: number) {
      serviceCalls.push({ method: 'limit', n })
      return chain
    },
    maybeSingle: vi.fn(async () => {
      serviceCalls.push({ method: 'maybeSingle' })
      return serviceQueue.shift() ?? { data: null, error: null }
    }),
    update(payload: unknown) {
      serviceCalls.push({ method: 'update', payload })
      if (currentTable() === 'payout_ledger') {
        // NOTE: eqArgs/inArgs are pushed by reference (not spread into a
        // copy) because the production chain is update().eq().in() /
        // update().eq().eq() — the filter calls run AFTER .update() in the
        // fluent chain, so a spread snapshot taken here would always be
        // empty. Assertions read these arrays only after the full chain
        // (and the `await` on the handler) has completed, by which point
        // the arrays are fully populated.
        ledgerUpdates.push({ payload: payload as Record<string, unknown>, eqArgs, inArgs })
      }
      return chain
    },
    insert(payload: unknown) {
      serviceCalls.push({ method: 'insert', payload })
      const table = currentTable()
      const arr = Array.isArray(payload) ? payload : [payload]
      for (const row of arr) {
        const r = row as Record<string, unknown>
        if (table === 'payout_ledger') ledgerInserts.push(r)
        if (table === 'admin_audit_log') auditInserts.push(r)
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
  ledgerUpdates.length = 0
  ledgerInserts.length = 0
  auditInserts.length = 0
  logCalls.length = 0
  vi.clearAllMocks()
}

function enqueue(data: unknown, error: unknown = null): void {
  serviceQueue.push({ data, error })
}

// ----- onDisputeCreated ------------------------------------------------------

describe('onDisputeCreated', () => {
  beforeEach(resetAll)
  afterEach(resetAll)

  it('returns error when payment_intent is missing', async () => {
    const { onDisputeCreated } = await import('./onDispute')
    const result = await onDisputeCreated({ id: 'dp_1', payment_intent: null })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('missing payment_intent')
  })

  it('returns error when the order cannot be found', async () => {
    const { onDisputeCreated } = await import('./onDispute')
    enqueue(null) // orders lookup
    const result = await onDisputeCreated({ id: 'dp_2', payment_intent: 'pi_missing' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('order not found')
  })

  it('freezes locked/available payout_ledger rows to pending_dispute', async () => {
    const { onDisputeCreated } = await import('./onDispute')
    enqueue({ id: 100, currency: 'USD' }) // orders lookup
    enqueue(null) // freeze UPDATE success
    enqueue(null) // audit insert

    const result = await onDisputeCreated({ id: 'dp_freeze', payment_intent: 'pi_100', reason: 'fraudulent' })

    expect(result.ok).toBe(true)
    expect(ledgerUpdates).toHaveLength(1)
    expect(ledgerUpdates[0]!.payload.status).toBe('pending_dispute')
    expect(ledgerUpdates[0]!.eqArgs).toContainEqual({ col: 'order_id', val: 100 })
    expect(ledgerUpdates[0]!.inArgs[0]!.vals).toEqual(['locked', 'available'])
  })

  it('returns error when the freeze UPDATE fails', async () => {
    const { onDisputeCreated } = await import('./onDispute')
    enqueue({ id: 101, currency: 'USD' })
    enqueue(null, { message: 'db timeout' })

    const result = await onDisputeCreated({ id: 'dp_freezefail', payment_intent: 'pi_101' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('freeze update failed')
  })

  it('writes an admin_audit_log row with action=payout_ledger_dispute_frozen', async () => {
    const { onDisputeCreated } = await import('./onDispute')
    enqueue({ id: 102, currency: 'USD' })
    enqueue(null)
    enqueue(null)

    await onDisputeCreated({ id: 'dp_audit', payment_intent: 'pi_102', reason: 'product_not_received' })

    expect(auditInserts).toHaveLength(1)
    expect(auditInserts[0]!.action).toBe('payout_ledger_dispute_frozen')
    expect(auditInserts[0]!.target_id).toBe('102')
  })
})

// ----- onDisputeClosed — won ------------------------------------------------

describe('onDisputeClosed — won', () => {
  beforeEach(resetAll)
  afterEach(resetAll)

  it('reverts pending_dispute rows back to available', async () => {
    const { onDisputeClosed } = await import('./onDispute')
    enqueue({ id: 200, currency: 'USD' }) // orders lookup
    enqueue(null) // unfreeze UPDATE
    enqueue(null) // audit insert

    const result = await onDisputeClosed({ id: 'dp_won', payment_intent: 'pi_200', status: 'won' })

    expect(result.ok).toBe(true)
    expect(ledgerUpdates).toHaveLength(1)
    expect(ledgerUpdates[0]!.payload.status).toBe('available')
    expect(ledgerUpdates[0]!.eqArgs).toContainEqual({ col: 'status', val: 'pending_dispute' })
    // No clawback ledger rows written on a won dispute.
    expect(ledgerInserts).toHaveLength(0)
  })

  it('returns error when the unfreeze UPDATE fails', async () => {
    const { onDisputeClosed } = await import('./onDispute')
    enqueue({ id: 201, currency: 'USD' })
    enqueue(null, { message: 'db timeout' })

    const result = await onDisputeClosed({ id: 'dp_wonfail', payment_intent: 'pi_201', status: 'won' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('unfreeze update failed')
  })
})

// ----- onDisputeClosed — lost (the money-losing case STUB-061 exists for) --

describe('onDisputeClosed — lost', () => {
  beforeEach(resetAll)
  afterEach(resetAll)

  it('is idempotent: an existing dispute-kind ledger row short-circuits with no further writes', async () => {
    const { onDisputeClosed } = await import('./onDispute')
    enqueue({ id: 300, currency: 'USD' }) // orders lookup
    enqueue({ id: 9999 }) // existing 'dispute' row found

    const result = await onDisputeClosed({ id: 'dp_dup', payment_intent: 'pi_300', status: 'lost' })

    expect(result.ok).toBe(true)
    expect(ledgerInserts).toHaveLength(0)
    expect(ledgerUpdates).toHaveLength(0)
  })

  it('voids not-yet-paid-out rows and writes a negative dispute row per order_item using the royalty_cents snapshot', async () => {
    const { onDisputeClosed } = await import('./onDispute')
    enqueue({ id: 301, currency: 'USD' }) // orders lookup
    enqueue(null) // no existing dispute row
    enqueue([
      { id: 5001, partner_id: 70, royalty_cents: 1500, royalty_pct_bps: 1500 },
      { id: 5002, partner_id: 71, royalty_cents: 800, royalty_pct_bps: 1000 },
    ]) // order_items
    enqueue(null) // void UPDATE
    enqueue(null) // payout_ledger.insert
    enqueue(null) // audit insert

    const result = await onDisputeClosed({ id: 'dp_lost', payment_intent: 'pi_301', status: 'lost' })

    expect(result.ok).toBe(true)
    // Void UPDATE targets the three not-yet-paid-out states.
    const voidUpdate = ledgerUpdates.find((u) => u.payload.status === 'void')
    expect(voidUpdate).toBeDefined()
    expect(voidUpdate!.inArgs[0]!.vals).toEqual(['locked', 'available', 'pending_dispute'])

    // Two negative dispute rows, one per order_item, full clawback.
    expect(ledgerInserts).toHaveLength(2)
    expect(ledgerInserts[0]!.kind).toBe('dispute')
    // The new debit row must be 'accruing' (same as onRefund.ts's
    // debit rows) — NOT 'void'. 'void' is what the pre-existing sale
    // rows get flipped to (excluded from payout); the new negative row
    // is the row of record for the balance impact and must be counted.
    expect(ledgerInserts[0]!.status).toBe('accruing')
    expect(ledgerInserts[0]!.amount_cents).toBe(-1500)
    expect(ledgerInserts[0]!.partner_id).toBe(70)
    expect(ledgerInserts[0]!.royalty_pct_bps).toBe(1500)
    expect(ledgerInserts[0]!.order_item_id).toBe(5001)
    expect(ledgerInserts[1]!.amount_cents).toBe(-800)
    expect(ledgerInserts[1]!.partner_id).toBe(71)
  })

  it('propagates order.currency to the dispute ledger rows', async () => {
    const { onDisputeClosed } = await import('./onDispute')
    enqueue({ id: 302, currency: 'EUR' })
    enqueue(null)
    enqueue([{ id: 6001, partner_id: 80, royalty_cents: 500, royalty_pct_bps: 2000 }])
    enqueue(null)
    enqueue(null)
    enqueue(null)

    await onDisputeClosed({ id: 'dp_eur', payment_intent: 'pi_302', status: 'lost' })

    expect(ledgerInserts[0]!.currency).toBe('EUR')
  })

  it('returns error when order_items lookup fails', async () => {
    const { onDisputeClosed } = await import('./onDispute')
    enqueue({ id: 303, currency: 'USD' })
    enqueue(null) // no existing dispute row
    enqueue(null, { message: 'db error' }) // order_items lookup fails

    const result = await onDisputeClosed({ id: 'dp_itemsfail', payment_intent: 'pi_303', status: 'lost' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('items lookup failed')
  })

  it('returns error when the ledger insert fails (money-losing path is surfaced, not swallowed)', async () => {
    const { onDisputeClosed } = await import('./onDispute')
    enqueue({ id: 304, currency: 'USD' })
    enqueue(null)
    enqueue([{ id: 7001, partner_id: 90, royalty_cents: 1200, royalty_pct_bps: 1500 }])
    enqueue(null) // void UPDATE succeeds
    enqueue(null, { message: 'constraint violation' }) // ledger insert FAILS

    const result = await onDisputeClosed({ id: 'dp_insertfail', payment_intent: 'pi_304', status: 'lost' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('ledger insert failed')
  })

  it('writes an admin_audit_log row with action=payout_ledger_dispute_lost', async () => {
    const { onDisputeClosed } = await import('./onDispute')
    enqueue({ id: 305, currency: 'USD' })
    enqueue(null)
    enqueue([{ id: 8001, partner_id: 91, royalty_cents: 900, royalty_pct_bps: 1500 }])
    enqueue(null)
    enqueue(null)
    enqueue(null)

    await onDisputeClosed({ id: 'dp_auditlost', payment_intent: 'pi_305', status: 'lost' })

    expect(auditInserts).toHaveLength(1)
    expect(auditInserts[0]!.action).toBe('payout_ledger_dispute_lost')
  })
})

// ----- onDisputeClosed — other / non-actionable statuses --------------------

describe('onDisputeClosed — non-actionable status', () => {
  beforeEach(resetAll)
  afterEach(resetAll)

  it('no-ops on a status other than won/lost (e.g. warning_closed)', async () => {
    const { onDisputeClosed } = await import('./onDispute')
    enqueue({ id: 400, currency: 'USD' })

    const result = await onDisputeClosed({ id: 'dp_warn', payment_intent: 'pi_400', status: 'warning_closed' })

    expect(result.ok).toBe(true)
    expect(ledgerUpdates).toHaveLength(0)
    expect(ledgerInserts).toHaveLength(0)
    expect(auditInserts).toHaveLength(0)
  })
})
