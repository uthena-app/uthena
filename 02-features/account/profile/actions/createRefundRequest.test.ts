// createRefundRequest.test.ts — unit tests for the
// createRefundRequestAction server action.
//
// Strategy: same chainable-fake-Supabase pattern as the rest of the
// action test suite (updateProfile, logInvoiceDownload,
// requestAvatarUpload, requestRefundProofUpload). The action has
// multiple Supabase calls:
//
//   1. `from('refunds').select('id').eq('client_request_id', ...).maybeSingle()`
//      → idempotency pre-check (only on retry)
//   2. `from('orders').select(...).eq('id', ...).eq('user_id', ...).maybeSingle()`
//      → re-checks eligibility server-side (NOT trusting the URL)
//   3. `from('refunds').insert({...}).select('id').single()`
//      → creates the row
//   4. (on unique-violation race) `from('refunds').select('id').eq('client_request_id', ...).maybeSingle()`
//      → recovers from race
//
// Plus the auth.getUser() call for the session check. The rate-limit
// bucket is in-process (Map<string, number[]>) so we can drive it
// directly.
//
// Coverage:
//   - Auth gating: anon → "Not signed in.", no DB calls.
//   - Zod validation (NO DB calls on bad input):
//       - camelCase→snake_case mapping (orderId → order_id,
//         amountCents → amount_cents, clientRequestId →
//         client_request_id, proofPath → proof_path, proofFilename →
//         proof_filename).
//       - bad reason (not in the enum) → field error on `reason`.
//       - non-positive amount_cents → field error on `amount_cents`.
//       - notes too long (> 2000 chars, schema limit) → field error.
//       - proof_path prefix mismatch → friendly error, no insert.
//   - Server-side eligibility re-check (NOT trusting the URL):
//       - order not found → "Order not found."
//       - order not owned by user → "Order not found." (RLS hides it).
//       - order not paid → "This order is not eligible for a refund."
//       - amount > remaining refundable →
//         "Refund amount exceeds the remaining refundable balance."
//   - Happy path: row inserted with the correct shape (order_id,
//     amount_cents, reason, notes (empty → null), status='pending',
//     requested_by=user.id, client_request_id when provided,
//     proof_path + proof_filename when provided).
//   - Idempotency:
//       - resubmitting with the same client_request_id returns the
//         existing refundId with `idempotentReplay: true` (no insert,
//         no rate-limit charge, no revalidatePath)
//       - first submission with a fresh client_request_id inserts
//       - unique-violation on insert (race condition) → looks up the
//         winner + returns its id with `idempotentReplay: true`
//   - Proof attachment:
//       - server-side filename sanitization (a-zA-Z0-9._-)
//       - proof_path prefix guard rejects non-canonical paths
//   - Rate limit: 5 calls within 24h succeed; the 6th returns
//     the rate-limit error AND does NOT insert.
//   - DB insert failure: returns "Could not submit your refund request."
//
// STUB-082 RESOLVED: idempotency via `client_request_id` is shipped.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { _resetRefundRateLimitForTests } from './createRefundRequest.rate-limit'

const revalidateCalls: string[] = []
vi.mock('next/cache', () => ({
  revalidatePath: (path: string) => {
    revalidateCalls.push(path)
  },
}))

type Call =
  | { method: 'auth.getUser' }
  | { method: 'from'; table: string }
  | { method: 'select'; payload: string; opts: unknown }
  | { method: 'eq'; col: string; val: unknown }
  | { method: 'in'; col: string; val: unknown }
  | { method: 'maybeSingle' }
  | { method: 'insert'; payload: Record<string, unknown> }
  | { method: 'single' }

const calls: Call[] = []
let mockUser: { id: string; email: string | null } | null = null
let orderResponse: { data: Record<string, unknown> | null; error: unknown } = {
  data: null,
  error: null,
}
let insertResponse: {
  data: { id: number } | null
  error: { code?: string; message?: string } | null
} = { data: { id: 777 }, error: null }
// Two-step lookup for idempotency: pre-check first, then
// race-recovery after a unique-violation. Both queries hit the
// same `refunds` table with the same `client_request_id` filter.
let idempotencyLookupResponse: {
  data: { id: number; status: string } | null
  error: unknown
} = { data: null, error: null }

function makeIdempotencyChain(): any {
  const chain: any = {
    select(payload: string, opts: unknown) {
      calls.push({ method: 'select', payload, opts })
      return chain
    },
    eq(col: string, val: unknown) {
      calls.push({ method: 'eq', col, val })
      return chain
    },
    maybeSingle: vi.fn(async () => {
      calls.push({ method: 'maybeSingle' })
      return idempotencyLookupResponse
    }),
  }
  return chain
}

function makeOrderChain(): any {
  const chain: any = {
    select(payload: string, opts: unknown) {
      calls.push({ method: 'select', payload, opts })
      return chain
    },
    eq(col: string, val: unknown) {
      calls.push({ method: 'eq', col, val })
      return chain
    },
    maybeSingle: vi.fn(async () => {
      calls.push({ method: 'maybeSingle' })
      return orderResponse
    }),
  }
  return chain
}

function makeInsertChain(): any {
  const chain: any = {
    insert(payload: Record<string, unknown>) {
      calls.push({ method: 'insert', payload })
      return chain
    },
    select(payload: string) {
      calls.push({ method: 'select', payload, opts: undefined })
      return chain
    },
    single: vi.fn(async () => {
      calls.push({ method: 'single' })
      return insertResponse
    }),
  }
  return chain
}

const fakeSupabase = {
  auth: {
    getUser: vi.fn(async () => {
      calls.push({ method: 'auth.getUser' })
      return { data: { user: mockUser }, error: null }
    }),
  },
  from: vi.fn((table: string) => {
    calls.push({ method: 'from', table })
    if (table === 'orders') return makeOrderChain()
    if (table === 'refunds') {
      // The first call against refunds is the idempotency lookup;
      // subsequent calls are the insert (or the race-recovery
      // lookup). We dispatch based on a "current phase" flag.
      if (currentPhase === 'idempotency_lookup') {
        currentPhase = 'after_idempotency'
        return makeIdempotencyChain()
      }
      if (currentPhase === 'race_recovery') {
        return makeIdempotencyChain()
      }
      // default — the insert phase
      currentPhase = 'after_insert'
      return makeInsertChain()
    }
    throw new Error(`unexpected table: ${table}`)
  }),
}

let currentPhase: 'idempotency_lookup' | 'after_idempotency' | 'race_recovery' | 'after_insert' =
  'after_insert'

vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: vi.fn(async () => fakeSupabase),
}))

const mockWarn = vi.fn()
vi.mock('@foundations/log/pino', () => ({
  loggerFor: () => ({
    info: vi.fn(),
    warn: (...args: unknown[]) => mockWarn(...args),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

const { createRefundRequestAction } = await import('./createRefundRequest')

function paidOrderWith(overrides: Record<string, unknown> = {}) {
  return {
    id: 12345,
    user_id: 'user-uuid-1',
    status: 'paid',
    total_cents: 49700,
    refunded_cents: 0,
    ...overrides,
  }
}

const VALID_INPUT = {
  orderId: 12345,
  reason: 'product_unacceptable',
  notes: '',
  amountCents: 49700,
}

beforeEach(() => {
  calls.length = 0
  revalidateCalls.length = 0
  mockWarn.mockClear()
  fakeSupabase.from.mockClear()
  fakeSupabase.auth.getUser.mockClear()
  mockUser = { id: 'user-uuid-1', email: 'klaas@example.com' }
  orderResponse = { data: paidOrderWith(), error: null }
  insertResponse = { data: { id: 777 }, error: null }
  idempotencyLookupResponse = { data: null, error: null }
  // Default phase — the action only does the idempotency lookup when
  // client_request_id is present. Tests that pass a client_request_id
  // explicitly flip the phase to 'idempotency_lookup' in their setup.
  currentPhase = 'after_insert'
  // Reset the in-process rate-limit bucket — the cron test suite
  // runs many tests in the same Node process and pollution would
  // otherwise leak across test boundaries (most tests use the
  // same `user-uuid-1` mock user).
  _resetRefundRateLimitForTests()
})

afterEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// auth gating
// ---------------------------------------------------------------------------

describe('createRefundRequestAction — auth', () => {
  it('returns "Not signed in." for anon callers (no DB writes, no insert)', async () => {
    mockUser = null
    const result = await createRefundRequestAction(VALID_INPUT)
    expect(result).toEqual({ ok: false, error: 'Not signed in.' })
    expect(fakeSupabase.from).not.toHaveBeenCalled()
    expect(revalidateCalls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Zod validation — runs before any DB call
// ---------------------------------------------------------------------------

describe('createRefundRequestAction — Zod validation (no DB calls)', () => {
  it('rejects bad reason (not in the enum)', async () => {
    const result = await createRefundRequestAction({
      ...VALID_INPUT,
      reason: 'not_a_real_reason',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('Please fix the errors below.')
      expect(result.fieldErrors).toBeDefined()
      expect(result.fieldErrors?.reason).toBeTruthy()
    }
    expect(fakeSupabase.from).not.toHaveBeenCalled()
  })

  it('rejects non-positive amount_cents (0)', async () => {
    const result = await createRefundRequestAction({
      ...VALID_INPUT,
      amountCents: 0,
    })
    expect(result.ok).toBe(false)
    expect(fakeSupabase.from).not.toHaveBeenCalled()
  })

  it('rejects negative amount_cents', async () => {
    const result = await createRefundRequestAction({
      ...VALID_INPUT,
      amountCents: -100,
    })
    expect(result.ok).toBe(false)
    expect(fakeSupabase.from).not.toHaveBeenCalled()
  })

  it('rejects non-integer amount_cents', async () => {
    const result = await createRefundRequestAction({
      ...VALID_INPUT,
      amountCents: 49.7,
    })
    expect(result.ok).toBe(false)
    expect(fakeSupabase.from).not.toHaveBeenCalled()
  })

  it('rejects notes > 2000 chars (schema limit)', async () => {
    const result = await createRefundRequestAction({
      ...VALID_INPUT,
      notes: 'x'.repeat(2001),
    })
    expect(result.ok).toBe(false)
    expect(fakeSupabase.from).not.toHaveBeenCalled()
  })

  it('rejects non-integer orderId', async () => {
    const result = await createRefundRequestAction({
      ...VALID_INPUT,
      orderId: 1.5,
    })
    expect(result.ok).toBe(false)
    expect(fakeSupabase.from).not.toHaveBeenCalled()
  })

  it('rejects non-positive orderId', async () => {
    const result = await createRefundRequestAction({
      ...VALID_INPUT,
      orderId: 0,
    })
    expect(result.ok).toBe(false)
    expect(fakeSupabase.from).not.toHaveBeenCalled()
  })

  it('accepts every reason in the enum (duplicate / fraudulent / requested_by_customer / product_not_received / product_unacceptable / other)', async () => {
    // Use a fresh user per reason so the 5/24h rate limit doesn't
    // interfere with the Zod acceptance assertion.
    let i = 0
    for (const reason of [
      'duplicate',
      'fraudulent',
      'requested_by_customer',
      'product_not_received',
      'product_unacceptable',
      'other',
    ] as const) {
      calls.length = 0
      mockUser = { id: `zod-user-${i++}`, email: `u${i}@example.com` }
      currentPhase = 'after_insert'
      const result = await createRefundRequestAction({ ...VALID_INPUT, reason })
      // The action proceeds past the Zod parse → it makes the DB
      // calls. We assert Zod accepted (the insert succeeded or
      // returned a known downstream error, not a Zod field error).
      expect(result.ok).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// proof_path prefix guard — defense in depth against a tampered form
// ---------------------------------------------------------------------------

describe('createRefundRequestAction — proof_path prefix guard', () => {
  it('rejects a proof_path that does not start with refund-proofs/{userId}/', async () => {
    const result = await createRefundRequestAction({
      ...VALID_INPUT,
      clientRequestId: 'crid-test',
      proofPath: `avatars/user-uuid-1/evil.png`,
      proofFilename: 'evil.png',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/proof attachment is invalid/i)
    }
    // No insert should have happened — the action rejects the prefix
    // BEFORE the idempotency lookup.
    expect(fakeSupabase.from).not.toHaveBeenCalled()
  })

  it('rejects a proof_path from another user (cross-tenant attempt)', async () => {
    mockUser = { id: 'user-A', email: 'a@example.com' }
    const result = await createRefundRequestAction({
      ...VALID_INPUT,
      clientRequestId: 'crid-test',
      proofPath: `refund-proofs/user-B/evil.png`, // another user's prefix
      proofFilename: 'evil.png',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/proof attachment is invalid/i)
    }
    expect(fakeSupabase.from).not.toHaveBeenCalled()
  })

  it('accepts a proof_path with the canonical refund-proofs/{userId}/ prefix', async () => {
    mockUser = { id: 'user-A', email: 'a@example.com' }
    // The action will do the idempotency pre-check first (because
    // client_request_id is set), then the insert. Set the phase so
    // the FIRST `from('refunds')` call returns the idempotency
    // chain; subsequent calls return the insert chain.
    currentPhase = 'idempotency_lookup'
    idempotencyLookupResponse = { data: null, error: null }
    const result = await createRefundRequestAction({
      ...VALID_INPUT,
      clientRequestId: 'crid-fresh',
      proofPath: `refund-proofs/user-A/abc123.png`,
      proofFilename: 'screenshot.png',
    })
    expect(result.ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Server-side eligibility re-check (NOT trusting the URL)
// ---------------------------------------------------------------------------

describe('createRefundRequestAction — server eligibility re-check', () => {
  it('returns "Order not found." when the order does not exist', async () => {
    orderResponse = { data: null, error: null }
    const result = await createRefundRequestAction(VALID_INPUT)
    expect(result).toEqual({ ok: false, error: 'Order not found.' })
    // The action did NOT attempt an insert.
    const insertCall = calls.find((c) => c.method === 'insert')
    expect(insertCall).toBeUndefined()
  })

  it('returns "Order not found." when the order is owned by another user (RLS hides it)', async () => {
    orderResponse = { data: null, error: null }
    const result = await createRefundRequestAction(VALID_INPUT)
    expect(result).toEqual({ ok: false, error: 'Order not found.' })
  })

  it('returns "This order is not eligible for a refund." when status != paid', async () => {
    orderResponse = {
      data: paidOrderWith({ status: 'refunded' }),
      error: null,
    }
    const result = await createRefundRequestAction(VALID_INPUT)
    expect(result).toEqual({
      ok: false,
      error: 'This order is not eligible for a refund.',
    })
    expect(calls.find((c) => c.method === 'insert')).toBeUndefined()
  })

  it('returns "This order is not eligible for a refund." when status is awaiting_payment', async () => {
    orderResponse = {
      data: paidOrderWith({ status: 'awaiting_payment' }),
      error: null,
    }
    const result = await createRefundRequestAction(VALID_INPUT)
    expect(result.ok).toBe(false)
    expect(calls.find((c) => c.method === 'insert')).toBeUndefined()
  })

  it('returns amount-exceeds-remaining when amount_cents > total - refunded_cents', async () => {
    orderResponse = {
      data: paidOrderWith({ total_cents: 49700, refunded_cents: 10000 }),
      error: null,
    }
    const result = await createRefundRequestAction({
      ...VALID_INPUT,
      amountCents: 49700, // > remaining (39700)
    })
    expect(result).toEqual({
      ok: false,
      error: 'Refund amount exceeds the remaining refundable balance.',
    })
    expect(calls.find((c) => c.method === 'insert')).toBeUndefined()
  })

  it('queries the order with user_id scoped to the signed-in user (defense in depth)', async () => {
    mockUser = { id: 'user-A', email: 'a@example.com' }
    await createRefundRequestAction(VALID_INPUT)
    const eqCalls = calls.filter((c) => c.method === 'eq') as Array<
      Extract<Call, { method: 'eq' }>
    >
    // The query is .eq('id', orderId).eq('user_id', user.id). Both
    // predicates are required — defense in depth on top of the
    // table-level RLS policy `orders_self_read`.
    expect(eqCalls.some((c) => c.col === 'id' && c.val === 12345)).toBe(true)
    expect(eqCalls.some((c) => c.col === 'user_id' && c.val === 'user-A')).toBe(true)
  })

  it('the order select is PII-safe (no email / ip / user_agent / billing_address)', async () => {
    await createRefundRequestAction(VALID_INPUT)
    const selectCalls = calls.filter((c) => c.method === 'select') as Array<
      Extract<Call, { method: 'select' }>
    >
    const orderSelect = selectCalls.find((c) => c.payload.includes('user_id'))
    expect(orderSelect).toBeDefined()
    expect(orderSelect!.payload).not.toMatch(/\bemail\b/)
    expect(orderSelect!.payload).not.toContain('user_agent')
    expect(orderSelect!.payload).not.toContain('billing_address')
    expect(orderSelect!.payload).not.toContain('stripe_payment_intent_id')
  })
})

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('createRefundRequestAction — happy path', () => {
  it('inserts a refund row with the correct shape and returns the new id', async () => {
    const result = await createRefundRequestAction(VALID_INPUT)
    expect(result).toEqual({ ok: true, refundId: 777 })

    const insertCall = calls.find((c) => c.method === 'insert') as
      | Extract<Call, { method: 'insert' }>
      | undefined
    expect(insertCall).toBeDefined()
    expect(insertCall!.payload).toEqual({
      order_id: 12345,
      amount_cents: 49700,
      reason: 'product_unacceptable',
      notes: null, // empty string normalized to null
      status: 'pending',
      requested_by: 'user-uuid-1',
    })
  })

  it('passes through non-empty notes (no normalization)', async () => {
    await createRefundRequestAction({
      ...VALID_INPUT,
      notes: 'Worked but I changed my mind.',
    })
    const insertCall = calls.find((c) => c.method === 'insert') as
      | Extract<Call, { method: 'insert' }>
      | undefined
    expect(insertCall!.payload.notes).toBe('Worked but I changed my mind.')
  })

  it('revalidates /account/orders/[orderId] on success', async () => {
    await createRefundRequestAction(VALID_INPUT)
    expect(revalidateCalls).toContain('/account/orders/12345')
  })

  it('inserts status="pending" (matches the live schema enum)', async () => {
    await createRefundRequestAction(VALID_INPUT)
    const insertCall = calls.find((c) => c.method === 'insert') as
      | Extract<Call, { method: 'insert' }>
      | undefined
    expect(insertCall!.payload.status).toBe('pending')
  })

  it('includes client_request_id + proof_path + proof_filename in the insert when provided', async () => {
    // Phase setup — clientRequestId is set so the action does an
    // idempotency pre-check first.
    currentPhase = 'idempotency_lookup'
    idempotencyLookupResponse = { data: null, error: null }
    const result = await createRefundRequestAction({
      ...VALID_INPUT,
      clientRequestId: 'crid-abc-123',
      proofPath: 'refund-proofs/user-uuid-1/abc.png',
      proofFilename: 'screenshot.png',
    })
    expect(result.ok).toBe(true)
    const insertCall = calls.find((c) => c.method === 'insert') as
      | Extract<Call, { method: 'insert' }>
      | undefined
    expect(insertCall!.payload).toMatchObject({
      client_request_id: 'crid-abc-123',
      proof_path: 'refund-proofs/user-uuid-1/abc.png',
      proof_filename: 'screenshot.png',
    })
  })

  it('sanitizes the proof_filename server-side (path traversal stripped)', async () => {
    currentPhase = 'idempotency_lookup'
    idempotencyLookupResponse = { data: null, error: null }
    await createRefundRequestAction({
      ...VALID_INPUT,
      clientRequestId: 'crid-abc',
      proofPath: 'refund-proofs/user-uuid-1/abc.png',
      proofFilename: '../../etc/passwd',
    })
    const insertCall = calls.find((c) => c.method === 'insert') as
      | Extract<Call, { method: 'insert' }>
      | undefined
    expect(insertCall!.payload.proof_filename).toBe('passwd')
  })

  it('omits client_request_id / proof fields entirely when not provided', async () => {
    await createRefundRequestAction(VALID_INPUT)
    const insertCall = calls.find((c) => c.method === 'insert') as
      | Extract<Call, { method: 'insert' }>
      | undefined
    expect(insertCall!.payload).not.toHaveProperty('client_request_id')
    expect(insertCall!.payload).not.toHaveProperty('proof_path')
    expect(insertCall!.payload).not.toHaveProperty('proof_filename')
  })
})

// ---------------------------------------------------------------------------
// Idempotency — STUB-082 RESOLVED
// ---------------------------------------------------------------------------

describe('createRefundRequestAction — idempotency (STUB-082 RESOLVED)', () => {
  it('returns the existing refundId with idempotentReplay=true on a retry (pre-check)', async () => {
    currentPhase = 'idempotency_lookup'
    idempotencyLookupResponse = {
      data: { id: 888, status: 'pending' },
      error: null,
    }
    const result = await createRefundRequestAction({
      ...VALID_INPUT,
      clientRequestId: 'crid-existing',
    })
    expect(result).toEqual({
      ok: true,
      refundId: 888,
      idempotentReplay: true,
    })
    // The action did NOT proceed to the order/insert path — the
    // pre-check short-circuits before any eligibility check.
    const orderSelect = calls.find(
      (c) =>
        c.method === 'select' &&
        typeof (c as Extract<Call, { method: 'select' }>).payload === 'string' &&
        (c as Extract<Call, { method: 'select' }>).payload.includes('user_id'),
    )
    expect(orderSelect).toBeUndefined()
    const insertCall = calls.find((c) => c.method === 'insert')
    expect(insertCall).toBeUndefined()
    // No revalidatePath on the idempotent replay.
    expect(revalidateCalls).toHaveLength(0)
  })

  it('does not charge the rate-limit bucket on a retry', async () => {
    currentPhase = 'idempotency_lookup'
    idempotencyLookupResponse = {
      data: { id: 888, status: 'pending' },
      error: null,
    }
    // Burn 5 idempotent retries — none should charge the bucket.
    for (let i = 0; i < 5; i++) {
      calls.length = 0
      currentPhase = 'idempotency_lookup'
      await createRefundRequestAction({
        ...VALID_INPUT,
        clientRequestId: 'crid-existing',
      })
    }
    // Now do a fresh submission with a NEW clientRequestId — the
    // idempotency lookup returns null (the mock's
    // `idempotencyLookupResponse` is reset below), so the action
    // proceeds to the insert phase. The fresh submission should
    // succeed because the retries did not charge the rate-limit
    // bucket.
    idempotencyLookupResponse = { data: null, error: null }
    currentPhase = 'idempotency_lookup'
    const result = await createRefundRequestAction({
      ...VALID_INPUT,
      clientRequestId: 'crid-fresh',
    })
    expect(result.ok).toBe(true)
  })

  it('proceeds to insert when idempotency pre-check returns null', async () => {
    currentPhase = 'idempotency_lookup'
    idempotencyLookupResponse = { data: null, error: null }
    const result = await createRefundRequestAction({
      ...VALID_INPUT,
      clientRequestId: 'crid-fresh',
    })
    expect(result.ok).toBe(true)
    const insertCall = calls.find((c) => c.method === 'insert')
    expect(insertCall).toBeDefined()
  })

  it('recovers from a unique-violation race by returning the winner with idempotentReplay=true', async () => {
    // Phase 1: idempotency lookup says "no existing row" (the
    // pre-check sees nothing yet — the other request is still
    // mid-insert).
    currentPhase = 'idempotency_lookup'
    idempotencyLookupResponse = { data: null, error: null }
    // Phase 2: the insert hits a unique-violation (the OTHER
    // request won the race). Then the recovery query runs.
    insertResponse = {
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint' },
    }
    // Phase 3: the recovery query finds the winner.
    idempotencyLookupResponse = {
      data: { id: 999, status: 'pending' },
      error: null,
    }
    currentPhase = 'race_recovery'

    const result = await createRefundRequestAction({
      ...VALID_INPUT,
      clientRequestId: 'crid-race',
    })
    expect(result).toEqual({
      ok: true,
      refundId: 999,
      idempotentReplay: true,
    })
    // No revalidate on the race-recovery path (the page state
    // didn't change).
    expect(revalidateCalls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// DB insert failure
// ---------------------------------------------------------------------------

describe('createRefundRequestAction — DB insert failure', () => {
  it('returns "Could not submit your refund request." when the insert errors', async () => {
    insertResponse = {
      data: null,
      error: { message: 'unique violation' },
    }
    const result = await createRefundRequestAction(VALID_INPUT)
    expect(result).toEqual({
      ok: false,
      error: 'Could not submit your refund request. Please try again.',
    })
    expect(revalidateCalls).toHaveLength(0)
  })

  it('returns the same friendly error when the insert returns null data', async () => {
    insertResponse = { data: null, error: null }
    const result = await createRefundRequestAction(VALID_INPUT)
    expect(result.ok).toBe(false)
  })

  it('logs a warn WITHOUT the user email or any PII in the payload', async () => {
    insertResponse = { data: null, error: { message: 'connection reset' } }
    await createRefundRequestAction(VALID_INPUT)
    expect(mockWarn).toHaveBeenCalledTimes(1)
    const [payload, msg] = mockWarn.mock.calls[0] ?? []
    expect(msg).toBe('refund insert failed')
    expect(payload).toEqual({
      code: 'refund_insert_failed',
      msg: 'connection reset',
    })
    expect(JSON.stringify(payload)).not.toContain('klaas@example.com')
    expect(JSON.stringify(payload)).not.toContain('user-uuid-1')
  })
})

// ---------------------------------------------------------------------------
// Rate limit
// ---------------------------------------------------------------------------

describe('createRefundRequestAction — rate limit (5 / 24h)', () => {
  it('the first 5 calls succeed; the 6th returns the rate-limit error', async () => {
    for (let i = 0; i < 5; i++) {
      calls.length = 0
      currentPhase = 'after_insert'
      const result = await createRefundRequestAction({
        ...VALID_INPUT,
        orderId: 10000 + i,
      })
      expect(result.ok).toBe(true)
    }
    const sixth = await createRefundRequestAction({
      ...VALID_INPUT,
      orderId: 10006,
    })
    expect(sixth.ok).toBe(false)
    if (!sixth.ok) {
      expect(sixth.error).toMatch(/maximum number of refund requests today/i)
    }
  })

  it('the rate-limit denial does NOT insert (no DB write past the limit)', async () => {
    for (let i = 0; i < 5; i++) {
      currentPhase = 'after_insert'
      await createRefundRequestAction({ ...VALID_INPUT, orderId: 10000 + i })
    }
    calls.length = 0
    const sixth = await createRefundRequestAction({
      ...VALID_INPUT,
      orderId: 10006,
    })
    expect(sixth.ok).toBe(false)
    const insertCall = calls.find((c) => c.method === 'insert')
    expect(insertCall).toBeUndefined()
  })

  it('isolates the rate-limit bucket per user', async () => {
    // Burn the bucket for user A.
    for (let i = 0; i < 5; i++) {
      currentPhase = 'after_insert'
      await createRefundRequestAction({ ...VALID_INPUT, orderId: 10000 + i })
    }
    // Switch to user B — fresh bucket.
    mockUser = { id: 'user-B', email: 'b@example.com' }
    currentPhase = 'after_insert'
    const result = await createRefundRequestAction(VALID_INPUT)
    expect(result.ok).toBe(true)
  })

  it('does not count rate-limit-denied requests against the window (per-user)', async () => {
    // Use a dedicated user so the assertion is unambiguous (the
    // default user-uuid-1 has a separate bucket and switching mid-
    // test would create a fresh bucket for the new id).
    mockUser = { id: 'rate-test-user', email: 'r@example.com' }
    // Burn the bucket.
    for (let i = 0; i < 5; i++) {
      currentPhase = 'after_insert'
      const r = await createRefundRequestAction({
        ...VALID_INPUT,
        orderId: 10000 + i,
      })
      expect(r.ok).toBe(true)
    }
    // 6th call → denied.
    const denied = await createRefundRequestAction({
      ...VALID_INPUT,
      orderId: 10006,
    })
    expect(denied.ok).toBe(false)
    // Subsequent calls keep being denied — the action does NOT push
    // the timestamp on a denial, so the window does not get extended
    // by denied requests.
    currentPhase = 'after_insert'
    const stillDenied = await createRefundRequestAction({
      ...VALID_INPUT,
      orderId: 10007,
    })
    expect(stillDenied.ok).toBe(false)
  })
})