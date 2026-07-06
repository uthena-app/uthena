// onSubscriptionEvent.test.ts — unit tests for the Stripe subscription
// webhook handlers in `02-features/subscriptions/actions/onSubscriptionEvent.ts`.
//
// Covers (P8.1 — library access sync contract):
//   - **onSubscriptionCreated / onSubscriptionUpdated** (share the
//     `upsertFromSub` path):
//     - Happy path: upserts the row with all the expected fields (status,
//       customer id, price id, period timestamps as ISO strings,
//       cancel_at_period_end, trial timestamps, metadata).
//     - Missing `user_id` metadata: returns
//       `{ ok: false, error: 'missing user_id metadata' }` + warn log.
//     - Upsert error (no row returned): returns
//       `{ ok: false, error: 'upsert failed' }` + error log.
//     - Idempotency: calling twice with the same `stripe_subscription_id`
//       triggers upsert with `onConflict: 'stripe_subscription_id'` both
//       times (DB constraint dedupes).
//   - **onSubscriptionDeleted**:
//     - Forces status='canceled' on the upserted row regardless of the
//       incoming status (the upsert overrides with the canceled enum).
//     - Returns ok on the happy path.
//     - Does NOT clean up `library_grants` rows — access is computed at
//       read time via `has_active_subscription(user_id)` (which excludes
//       'canceled'), so flipping the status is enough.
//   - **onInvoiceEvent**:
//     - No subscription attached (`inv.subscription == null`): ignored,
//       no DB writes; returns `{ ok: true, ignored: true }`.
//     - `invoice.paid` with a subscription: flips status='active' on
//       the local row, appends a `payout_ledger` row with
//       `kind='subscription'`, `amount_cents=invoice.amount_due`,
//       `partner_id=null` (platform revenue, not partner-attributed).
//     - `invoice.paid` with no local sub row: status update succeeds,
//       ledger insert is skipped (the SELECT returns null).
//     - `invoice.paid` with `amount_due <= 0`: ledger insert skipped
//       (the helper short-circuits).
//     - `invoice.open` / `invoice.uncollectible`: status flips to
//       'past_due'; no ledger row.
//     - Update fails: returns `{ ok: false, error: 'update failed' }`
//       + warn log.
//   - **PII safety**: log payloads include only `code`, `msg`, `sub_id`,
//     `subscription_id`, `user_id`. No email, no Stripe customer id,
//     no Stripe price id, no full subscription object.
//
// Strategy: vi.mock the service-role Supabase client (chainable fake
// with terminalQueue for ordered reads + upsert/update capture), the
// logger (capture calls for PII-safety assertions), and use a typed
// `validSub` fixture that mirrors the `SubShape` consumed by the source.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ----- Mock the service-role Supabase client -----------------------------
type Call =
  | { method: 'from'; table: string }
  | { method: 'select'; payload: unknown }
  | { method: 'eq'; col: string; val: unknown }
  | { method: 'single' }
  | { method: 'maybeSingle' }
  | { method: 'upsert'; payload: unknown; opts: unknown }
  | { method: 'update'; payload: unknown }
  | { method: 'then' }

const serviceCalls: Call[] = []
let serviceQueue: Array<{ data: unknown; error: unknown }> = []

// Captured upsert payloads, partitioned by table so we can find the
// subscriptions vs payout_ledger rows quickly. Each entry records the
// row + the postgrest opts so we can assert `onConflict` /
// `ignoreDuplicates` in the tests.
const upsertPayloads: Array<{
  table: string
  row: Record<string, unknown>
  opts: unknown
}> = []

// Captured update payloads, partitioned by table. The onSubscriptionEvent
// source calls `.update().eq(...)` without `.single()`, so the result is
// resolved via the chain's implicit `.then()`.
const updatePayloads: Array<{
  table: string
  row: Record<string, unknown>
}> = []

function makeChain(currentTable: () => string) {
  const chain: any = {
    select(payload: unknown) {
      serviceCalls.push({ method: 'select', payload })
      return chain
    },
    eq(col: string, val: unknown) {
      serviceCalls.push({ method: 'eq', col, val })
      return chain
    },
    single: vi.fn(async () => {
      serviceCalls.push({ method: 'single' })
      return serviceQueue.shift() ?? { data: null, error: null }
    }),
    maybeSingle: vi.fn(async () => {
      serviceCalls.push({ method: 'maybeSingle' })
      return serviceQueue.shift() ?? { data: null, error: null }
    }),
    upsert(payload: unknown, opts: unknown) {
      serviceCalls.push({ method: 'upsert', payload, opts })
      upsertPayloads.push({
        table: currentTable(),
        row: payload as Record<string, unknown>,
        opts,
      })
      return chain
    },
    update(payload: unknown) {
      serviceCalls.push({ method: 'update', payload })
      updatePayloads.push({
        table: currentTable(),
        row: payload as Record<string, unknown>,
      })
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
    // Closure captures the table for this chain so upsert/update can
    // attribute themselves correctly without a separate side-channel.
    return makeChain(() => table)
  }),
}

vi.mock('@foundations/data/supabase', () => ({
  getServiceSupabase: vi.fn(() => fakeServiceSupabase),
}))

// ----- Mock logger (capture for PII-safety assertion) -------------------
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

// ----- Helpers ------------------------------------------------------------
//
// Fixture mirrors the source's SubShape. The real handler accepts a real
// Stripe.Subscription cast to SubShape; our mock just provides the fields
// the source actually reads (everything else is ignored).
const NOW = Math.floor(Date.now() / 1000)
// Typed as the SubShape the source actually consumes (re-declared here
// since the source doesn't export it). Every call site passes the
// fixture as `as never` to keep the test surface uncluttered by the
// 11-property SubShape declaration.
type SubShapeFixture = {
  id: string
  customer: string
  status: string
  current_period_start?: number | null
  current_period_end?: number | null
  cancel_at_period_end?: boolean | null
  canceled_at?: number | null
  items?: { data: Array<{ price: { id: string } }> }
  metadata?: Record<string, string> | null
  trial_start?: number | null
  trial_end?: number | null
}
const validSub: SubShapeFixture = {
  id: 'sub_test_123',
  customer: 'cus_test_abc',
  status: 'active',
  current_period_start: NOW,
  current_period_end: NOW + 86400 * 30,
  cancel_at_period_end: false,
  canceled_at: null,
  items: { data: [{ price: { id: 'price_personal_monthly' } }] },
  metadata: { user_id: 'u_test_1' },
  trial_start: null,
  trial_end: null,
}

// ----- Import after mocks -------------------------------------------------
const {
  onSubscriptionCreated,
  onSubscriptionUpdated,
  onSubscriptionDeleted,
  onInvoiceEvent,
} = await import('./onSubscriptionEvent')

beforeEach(() => {
  serviceCalls.length = 0
  serviceQueue = []
  upsertPayloads.length = 0
  updatePayloads.length = 0
  logCalls.length = 0
  fakeServiceSupabase.from.mockClear()
})

afterEach(() => {
  // Defensive: fail loudly if any entry was left on the queue (the
  // test under-specified its read expectations).
  if (serviceQueue.length > 0) {
    throw new Error(`serviceQueue had ${serviceQueue.length} unread entries — test mis-specified its fixtures`)
  }
})

// ============================================================================
// onSubscriptionCreated
// ============================================================================
describe('onSubscriptionCreated', () => {
  it('upserts the subscription row on the happy path', async () => {
    serviceQueue = [{ data: { id: 42 }, error: null }]
    const res = await onSubscriptionCreated(validSub)
    expect(res).toEqual({ ok: true, row_id: 42 })
    expect(upsertPayloads).toHaveLength(1)
    expect(upsertPayloads[0]!.table).toBe('subscriptions')
    expect(upsertPayloads[0]!.opts).toEqual({ onConflict: 'stripe_subscription_id' })
  })

  it('writes all the subscription fields as ISO timestamps + correct status enum', async () => {
    serviceQueue = [{ data: { id: 42 }, error: null }]
    await onSubscriptionCreated(validSub)
    const row = upsertPayloads[0]!.row
    expect(row.user_id).toBe('u_test_1')
    expect(row.stripe_subscription_id).toBe('sub_test_123')
    expect(row.stripe_customer_id).toBe('cus_test_abc')
    expect(row.stripe_price_id).toBe('price_personal_monthly')
    expect(row.status).toBe('active')
    expect(row.cancel_at_period_end).toBe(false)
    // ISO 8601 round-trip — period timestamps come in as Unix seconds,
    // the handler converts them via `new Date(n * 1000).toISOString()`.
    expect(typeof row.current_period_start).toBe('string')
    expect(row.current_period_start).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(typeof row.current_period_end).toBe('string')
    expect(row.current_period_end).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    // Metadata is passed through (PostgREST jsonb column).
    expect(row.metadata).toEqual({ user_id: 'u_test_1' })
    // updated_at is set to a fresh ISO timestamp.
    expect(typeof row.updated_at).toBe('string')
  })

  it('uses the passed status enum, not a hardcoded "active"', async () => {
    serviceQueue = [{ data: { id: 42 }, error: null }]
    await onSubscriptionCreated({ ...validSub, status: 'trialing' })
    expect(upsertPayloads[0]!.row.status).toBe('trialing')
  })

  it('returns error when user_id metadata is missing — no DB writes', async () => {
    const res = await onSubscriptionCreated({ ...validSub, metadata: {} })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error).toBe('missing user_id metadata')
    }
    // No upsert / update calls — the handler short-circuits before
    // touching the DB. This protects against an INSERT/UPDATE on a
    // missing user_id (which would violate the FK to auth.users).
    expect(upsertPayloads).toHaveLength(0)
    expect(updatePayloads).toHaveLength(0)
  })

  it('returns error when user_id metadata is null', async () => {
    const res = await onSubscriptionCreated({ ...validSub, metadata: null })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error).toBe('missing user_id metadata')
    }
  })

  it('returns error when upsert returns an error', async () => {
    serviceQueue = [{ data: null, error: { message: 'connection refused' } }]
    const res = await onSubscriptionCreated(validSub)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error).toBe('upsert failed')
    }
  })

  it('returns error when upsert returns no row (defensive: data is null)', async () => {
    serviceQueue = [{ data: null, error: null }]
    const res = await onSubscriptionCreated(validSub)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error).toBe('upsert failed')
    }
  })

  it('warns with a PII-safe payload when user_id is missing', async () => {
    await onSubscriptionCreated({ ...validSub, metadata: {} })
    const warn = logCalls.find((l) => l.level === 'warn')
    expect(warn).toBeDefined()
    const payload = JSON.stringify(warn!.payload)
    expect(payload).toMatch(/sub_no_user_id/)
    expect(payload).not.toMatch(/cus_test_abc/)
    // sub_id is included as a Stripe reference (operationally useful
    // for support); the test asserts the absence of email/price/etc.
    expect(payload).not.toMatch(/price_/)
  })
})

// ============================================================================
// onSubscriptionUpdated
// ============================================================================
describe('onSubscriptionUpdated', () => {
  it('shares the upsert path with onSubscriptionCreated', async () => {
    serviceQueue = [{ data: { id: 42 }, error: null }]
    const res = await onSubscriptionUpdated(validSub)
    expect(res).toEqual({ ok: true, row_id: 42 })
    expect(upsertPayloads).toHaveLength(1)
    expect(upsertPayloads[0]!.table).toBe('subscriptions')
  })

  it('is idempotent — calling twice with same stripe_subscription_id triggers upsert with onConflict both times', async () => {
    serviceQueue = [
      { data: { id: 42 }, error: null },
      { data: { id: 42 }, error: null },
    ]
    await onSubscriptionUpdated(validSub)
    await onSubscriptionUpdated({ ...validSub, status: 'past_due' })
    expect(upsertPayloads).toHaveLength(2)
    // Second upsert reflects the new status (DB upsert updates in place).
    expect(upsertPayloads[1]!.row.status).toBe('past_due')
    // Both used the onConflict stripe_subscription_id.
    expect(upsertPayloads[0]!.opts).toEqual({ onConflict: 'stripe_subscription_id' })
    expect(upsertPayloads[1]!.opts).toEqual({ onConflict: 'stripe_subscription_id' })
  })
})

// ============================================================================
// onSubscriptionDeleted
// ============================================================================
describe('onSubscriptionDeleted', () => {
  it('forces status=canceled on the upserted row regardless of incoming status', async () => {
    serviceQueue = [{ data: { id: 42 }, error: null }]
    const res = await onSubscriptionDeleted({ ...validSub, status: 'active' })
    expect(res).toEqual({ ok: true, row_id: 42 })
    expect(upsertPayloads[0]!.row.status).toBe('canceled')
  })

  it('forces status=canceled even if Stripe sends status=already-canceled (idempotent path)', async () => {
    serviceQueue = [{ data: { id: 42 }, error: null }]
    await onSubscriptionDeleted({ ...validSub, status: 'canceled' })
    expect(upsertPayloads[0]!.row.status).toBe('canceled')
  })

  it('does NOT clean up library_grants (access is computed at read time via has_active_subscription)', async () => {
    serviceQueue = [{ data: { id: 42 }, error: null }]
    await onSubscriptionDeleted(validSub)
    // The handler must not DELETE / UPDATE library_grants — the
    // user_accessible_products RPC re-evaluates has_active_subscription
    // on every /library render, so flipping the subscription status
    // to 'canceled' is enough to revoke access without any grant
    // cleanup work.
    const tables = serviceCalls
      .filter((c): c is Extract<Call, { method: 'from' }> => c.method === 'from')
      .map((c) => c.table)
    expect(tables).not.toContain('library_grants')
  })

  it('propagates upsert errors to the caller', async () => {
    serviceQueue = [{ data: null, error: { message: 'disk full' } }]
    const res = await onSubscriptionDeleted(validSub)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error).toBe('upsert failed')
    }
  })
})

// ============================================================================
// onInvoiceEvent
// ============================================================================
describe('onInvoiceEvent', () => {
  it('ignores invoices with no subscription attached — no DB writes', async () => {
    const res = await onInvoiceEvent({
      id: 'in_123',
      subscription: null,
      status: 'paid',
      amount_due: 2000,
    } as never)
    expect(res).toEqual({ ok: true, ignored: true })
    expect(upsertPayloads).toHaveLength(0)
    expect(updatePayloads).toHaveLength(0)
  })

  it('flips subscription status to active on invoice.paid', async () => {
    // First call: update().eq() resolves via the chain's then()
    // Second call: select().eq().maybeSingle() for the sub lookup
    serviceQueue = [
      { data: null, error: null },                          // update
      { data: null, error: null },                          // maybeSingle returns null (no sub row)
    ]
    const res = await onInvoiceEvent({
      id: 'in_123',
      subscription: 'sub_test_123',
      status: 'paid',
      amount_due: 2000,
    } as never)
    expect(res.ok).toBe(true)
    const subUpdate = updatePayloads.find((u) => u.table === 'subscriptions')
    expect(subUpdate).toBeDefined()
    expect(subUpdate!.row.status).toBe('active')
    expect(typeof subUpdate!.row.updated_at).toBe('string')
  })

  it('appends payout_ledger subscription row on invoice.paid when sub row exists', async () => {
    serviceQueue = [
      { data: null, error: null },                                      // update
      { data: { id: 5, user_id: 'u_test_1' }, error: null },            // maybeSingle (sub found)
      { data: null, error: null },                                      // ledger upsert
    ]
    await onInvoiceEvent({
      id: 'in_456',
      subscription: 'sub_test_123',
      status: 'paid',
      amount_due: 2900,
    } as never)
    const ledgerUpsert = upsertPayloads.find((u) => u.table === 'payout_ledger')
    expect(ledgerUpsert).toBeDefined()
    expect(ledgerUpsert!.row.kind).toBe('subscription')
    expect(ledgerUpsert!.row.status).toBe('accruing')
    expect(ledgerUpsert!.row.amount_cents).toBe(2900)
    expect(ledgerUpsert!.row.currency).toBe('USD')
    expect(ledgerUpsert!.row.stripe_invoice_id).toBe('in_456')
    expect(ledgerUpsert!.row.partner_id).toBeNull()
    expect(ledgerUpsert!.opts).toEqual({ onConflict: 'stripe_invoice_id', ignoreDuplicates: true })
  })

  it('skips the ledger insert when the subscription row is missing', async () => {
    serviceQueue = [
      { data: null, error: null },                  // update
      { data: null, error: null },                  // maybeSingle returns null
    ]
    await onInvoiceEvent({
      id: 'in_789',
      subscription: 'sub_xyz_no_row',
      status: 'paid',
      amount_due: 2000,
    } as never)
    expect(upsertPayloads.find((u) => u.table === 'payout_ledger')).toBeUndefined()
  })

  it('skips the ledger insert when amount_due <= 0 (defensive short-circuit)', async () => {
    serviceQueue = [
      { data: null, error: null },
      { data: { id: 5, user_id: 'u_test_1' }, error: null },
    ]
    await onInvoiceEvent({
      id: 'in_zero',
      subscription: 'sub_test_123',
      status: 'paid',
      amount_due: 0,
    } as never)
    expect(upsertPayloads.find((u) => u.table === 'payout_ledger')).toBeUndefined()
  })

  it('skips the ledger insert when amount_due is negative', async () => {
    serviceQueue = [
      { data: null, error: null },
      { data: { id: 5, user_id: 'u_test_1' }, error: null },
    ]
    await onInvoiceEvent({
      id: 'in_neg',
      subscription: 'sub_test_123',
      status: 'paid',
      amount_due: -100,
    } as never)
    expect(upsertPayloads.find((u) => u.table === 'payout_ledger')).toBeUndefined()
  })

  it('flips subscription status to past_due on invoice.open', async () => {
    serviceQueue = [{ data: null, error: null }]
    await onInvoiceEvent({
      id: 'in_failed',
      subscription: 'sub_test_123',
      status: 'open',
      amount_due: 2000,
    } as never)
    const subUpdate = updatePayloads.find((u) => u.table === 'subscriptions')
    expect(subUpdate).toBeDefined()
    expect(subUpdate!.row.status).toBe('past_due')
    expect(upsertPayloads.find((u) => u.table === 'payout_ledger')).toBeUndefined()
  })

  it('flips subscription status to past_due on invoice.uncollectible', async () => {
    serviceQueue = [{ data: null, error: null }]
    await onInvoiceEvent({
      id: 'in_unc',
      subscription: 'sub_test_123',
      status: 'uncollectible',
      amount_due: 2000,
    } as never)
    const subUpdate = updatePayloads.find((u) => u.table === 'subscriptions')
    expect(subUpdate!.row.status).toBe('past_due')
  })

  it('returns error when the subscription update fails', async () => {
    serviceQueue = [{ data: null, error: { message: 'connection refused' } }]
    const res = await onInvoiceEvent({
      id: 'in_x',
      subscription: 'sub_test_123',
      status: 'paid',
      amount_due: 2000,
    } as never)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error).toBe('update failed')
    }
  })

  it('warns with the code sub_ledger_insert_failed when ledger upsert errors (non-fatal)', async () => {
    serviceQueue = [
      { data: null, error: null },                            // update
      { data: { id: 5, user_id: 'u_test_1' }, error: null },  // maybeSingle
      { data: null, error: { message: 'ledger write failed' } }, // ledger upsert error
    ]
    const res = await onInvoiceEvent({
      id: 'in_ledger_fail',
      subscription: 'sub_test_123',
      status: 'paid',
      amount_due: 2900,
    } as never)
    // Still ok — the ledger insert is non-fatal by design (the user
    // got their subscription, the ledger row is for accounting and
    // can be backfilled separately).
    expect(res.ok).toBe(true)
    const warn = logCalls.find((l) => l.level === 'warn' && JSON.stringify(l.payload).includes('sub_ledger_insert_failed'))
    expect(warn).toBeDefined()
  })
})

// ============================================================================
// PII safety
// ============================================================================
describe('PII safety', () => {
  it('warn logs never include Stripe customer id or email', async () => {
    serviceQueue = [{ data: { id: 42 }, error: null }]
    await onSubscriptionCreated({
      ...validSub,
      customer: 'cus_secret_id_pii',
    })
    const allLogs = JSON.stringify(logCalls)
    expect(allLogs).not.toContain('cus_secret_id_pii')
    expect(allLogs).not.toMatch(/cus_/)
  })

  it('warn logs include the Stripe sub id (operationally useful) but no price id', async () => {
    // metadata is empty → handler short-circuits before touching the DB.
    serviceQueue = []
    await onSubscriptionCreated({ ...validSub, metadata: {} })
    const warn = logCalls.find((l) => l.level === 'warn')
    expect(warn).toBeDefined()
    const payload = JSON.stringify(warn!.payload)
    // The handler logs sub_id for support correlation. It's the Stripe
    // sub id (not a hash), which is intentional — the handler doesn't
    // have an internal id to log instead. Acceptable: it's an opaque
    // Stripe identifier, not user PII.
    expect(payload).toContain('sub_test_123')
    // No price id leaked.
    expect(payload).not.toContain('price_personal_monthly')
  })

  it('error logs never include email or customer email', async () => {
    serviceQueue = [{ data: null, error: null }]
    await onSubscriptionCreated(validSub)
    const allLogs = JSON.stringify(logCalls)
    expect(allLogs).not.toMatch(/@/)
    expect(allLogs).not.toMatch(/cus_/)
  })
})

// ============================================================================
// Library-access-sync contract — end-to-end semantic verification
// ============================================================================
//
// These tests don't touch the RPC itself (the RPC is verified by the
// migration's CHECK + the manual run-against-staging test plan). They
// verify the handler writes the row in the exact shape the RPC reads:
//   - has_active_subscription(user_id) reads `status` and
//     `current_period_end` from the local row.
//   - user_accessible_products(user_id) returns subscription rows only
//     when has_active_subscription is true.
// So the handler's contract is: keep the row's `status` field in the
// canonical 8-value enum, and keep `current_period_end` as an ISO
// timestamp (so the RPC's `current_period_end > now()` comparison works).
describe('library-access-sync contract', () => {
  it('writes a status the RPC will treat as active (status in active|trialing)', async () => {
    serviceQueue = [{ data: { id: 42 }, error: null }]
    await onSubscriptionCreated({ ...validSub, status: 'trialing' })
    const row = upsertPayloads[0]!.row
    // has_active_subscription checks: status IN ('active', 'trialing')
    expect(['active', 'trialing']).toContain(row.status)
  })

  it('writes a current_period_end as ISO so the RPC can compare against now()', async () => {
    serviceQueue = [{ data: { id: 42 }, error: null }]
    await onSubscriptionCreated(validSub)
    const row = upsertPayloads[0]!.row
    // ISO 8601 with milliseconds + Z. The RPC's
    // `current_period_end > now()` comparison requires this format.
    expect(row.current_period_end).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })

  it('on cancellation writes status=canceled so the RPC excludes the user', async () => {
    serviceQueue = [{ data: { id: 42 }, error: null }]
    await onSubscriptionDeleted({ ...validSub, status: 'active' })
    const row = upsertPayloads[0]!.row
    // has_active_subscription: status IN ('active', 'trialing')
    // 'canceled' is NOT in that set → user is excluded.
    expect(['active', 'trialing']).not.toContain(row.status)
    expect(row.status).toBe('canceled')
  })

  it('on past_due via invoice.open the RPC excludes the user', async () => {
    serviceQueue = [{ data: null, error: null }]
    await onInvoiceEvent({
      id: 'in_pd',
      subscription: 'sub_test_123',
      status: 'open',
      amount_due: 2000,
    } as never)
    const row = updatePayloads.find((u) => u.table === 'subscriptions')!.row
    expect(row.status).toBe('past_due')
    expect(['active', 'trialing']).not.toContain(row.status)
  })
})
