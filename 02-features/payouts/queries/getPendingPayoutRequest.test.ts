// getPendingPayoutRequest.test.ts — unit tests for the P6.6
// `getPendingPayoutRequest` query.
//
// Covers:
//   - **Auth gating**: no session user → null, no DB calls.
//   - **Partner-row gating**: no partner row → null (race during
//     onboarding; the partner row is needed to key the
//     payout_requests query).
//   - **Happy path (pending exists)**: returns the mapped
//     PendingPayoutRequest with every required field.
//   - **Happy path (no pending)**: returns null + no warn log.
//   - **DB error**: returns null + warn log (fail-soft contract).
//   - **Defensive mapping**: missing amount_cents / currency /
//     masked / etc. → null (fail-closed if DB constraint regresses).
//   - **Query shape**: asserts the .eq partner_id + status='pending'
//     + .order + .limit(1) clauses hit the captured call list.
//   - **PII safety**: no raw partner_id / user_id / email in any
//     log payload.
//
// Pattern follows `getPartnerLedger.test.ts` — chainable fake
// Supabase + queued results + Pino mock with log-call capture.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ----- Mocks ---------------------------------------------------------------

type ServerCall =
  | { method: 'from'; table: string }
  | { method: 'select'; payload: unknown }
  | { method: 'eq'; col: string; val: unknown }
  | { method: 'order'; col: string; ascending?: boolean | undefined }
  | { method: 'limit'; n: number }
  | { method: 'maybeSingle' }
  | { method: 'single' }

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
    order(col: string, opts?: { ascending?: boolean }) {
      const ascending = opts && 'ascending' in opts ? opts.ascending : undefined
      serverCalls.push({ method: 'order', col, ascending })
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
}))

// ----- Logger mock (PII-safety assertions) --------------------------------

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

// ----- Auth mock ----------------------------------------------------------

let mockSessionUser: { id: string; email: string; role: string; display_name: string } | null = {
  id: 'user_1',
  email: 'partner@example.com',
  role: 'partner',
  display_name: 'Partner One',
}

vi.mock('@foundations/auth/guards', () => ({
  getSessionUser: vi.fn(async () => mockSessionUser),
}))

// ----- Test state ---------------------------------------------------------

beforeEach(() => {
  serverCalls.length = 0
  serverQueue = []
  logCalls.length = 0
  mockSessionUser = {
    id: 'user_1',
    email: 'partner@example.com',
    role: 'partner',
    display_name: 'Partner One',
  }
})

afterEach(() => {
  vi.clearAllMocks()
})

// ----- Imports under test ------------------------------------------------

const { getPendingPayoutRequest } = await import('./getPendingPayoutRequest')

// ----- Helpers ------------------------------------------------------------

function enqueuePartner(id = 42) {
  serverQueue.push({ data: { id }, error: null })
}

function enqueuePending(overrides: Partial<{
  amount_cents: number
  currency: string
  payout_method_target_masked: string
  created_at: string
}> = {}) {
  serverQueue.push({
    data: {
      id: 555,
      amount_cents: 12500,
      currency: 'USD',
      status: 'pending',
      payout_method_kind: 'paypal',
      payout_method_target_masked: 'k***@example.com',
      created_at: '2026-06-26T08:00:00Z',
      ...overrides,
    },
    error: null,
  })
}

function findCalls(predicate: (c: ServerCall) => boolean): ServerCall[] {
  return serverCalls.filter(predicate)
}

// ----- Tests --------------------------------------------------------------

describe('getPendingPayoutRequest — auth gating', () => {
  it('returns null when no session user', async () => {
    mockSessionUser = null
    const result = await getPendingPayoutRequest()
    expect(result).toBeNull()
    // No DB reads for anon callers.
    expect(serverCalls).toHaveLength(0)
  })

  it('returns null when partner row not found', async () => {
    serverQueue.push({ data: null, error: null }) // partners: empty
    const result = await getPendingPayoutRequest()
    expect(result).toBeNull()
  })

  it('returns null when partner read errors (fail-soft)', async () => {
    serverQueue.push({ data: null, error: { message: 'partners unavailable' } })
    const result = await getPendingPayoutRequest()
    expect(result).toBeNull()
  })
})

describe('getPendingPayoutRequest — happy path', () => {
  it('returns the mapped pending request', async () => {
    enqueuePartner(99)
    enqueuePending()
    const result = await getPendingPayoutRequest()
    expect(result).toEqual({
      id: 555,
      amount_cents: 12500,
      currency: 'USD',
      status: 'pending',
      payout_method_kind: 'paypal',
      payout_method_target_masked: 'k***@example.com',
      created_at: '2026-06-26T08:00:00Z',
    })
  })

  it('returns null when no pending request exists', async () => {
    enqueuePartner()
    serverQueue.push({ data: null, error: null }) // payout_requests: empty
    const result = await getPendingPayoutRequest()
    expect(result).toBeNull()
    // No warn log on the happy-empty path.
    expect(logCalls.find((c) => c.level === 'warn')).toBeUndefined()
  })

  it('reads payout_requests with the right shape (partner_id eq, status=pending, order+limit)', async () => {
    enqueuePartner(77)
    enqueuePending()
    await getPendingPayoutRequest()

    // The query should select only the columns the page reads.
    const selectCall = findCalls((c) => c.method === 'select').pop() as
      | { method: 'select'; payload: unknown }
      | undefined
    const selectPayload = String(selectCall?.payload)
    expect(selectPayload).toContain('id')
    expect(selectPayload).toContain('amount_cents')
    expect(selectPayload).toContain('currency')
    expect(selectPayload).toContain('status')
    expect(selectPayload).toContain('payout_method_kind')
    expect(selectPayload).toContain('payout_method_target_masked')
    expect(selectPayload).toContain('created_at')

    // The where clauses.
    const eqs = findCalls((c) => c.method === 'eq').map((c) =>
      c.method === 'eq' ? [c.col, c.val] : [],
    )
    expect(eqs).toContainEqual(['partner_id', 77])
    expect(eqs).toContainEqual(['status', 'pending'])

    // Order + limit — newest first, single row.
    const orders = findCalls((c) => c.method === 'order').map((c) =>
      c.method === 'order' ? [c.col, c.ascending] : [],
    )
    expect(orders).toContainEqual(['created_at', false])
    expect(orders).toContainEqual(['id', false])
    const limits = findCalls((c) => c.method === 'limit').map((c) =>
      c.method === 'limit' ? c.n : 0,
    )
    expect(limits).toContain(1)
  })
})

describe('getPendingPayoutRequest — DB error', () => {
  it('returns null + warns (fail-soft) on payout_requests read error', async () => {
    enqueuePartner()
    serverQueue.push({ data: null, error: { message: 'payout_requests unavailable' } })
    const result = await getPendingPayoutRequest()
    expect(result).toBeNull()
    // Single warn log with the redacted hash, no raw partner_id.
    const warns = logCalls.filter((c) => c.level === 'warn')
    expect(warns).toHaveLength(1)
    expect(warns[0]?.payload.code).toBe('pending_request_read_failed')
    expect(String(warns[0]?.payload.partner_id_hash)).not.toContain('user_1')
    expect(String(warns[0]?.payload.partner_id_hash)).not.toContain('42')
    expect(JSON.stringify(warns[0]?.payload)).not.toContain('partner@example.com')
  })
})

describe('getPendingPayoutRequest — defensive mapping', () => {
  it('returns null when amount_cents is missing', async () => {
    enqueuePartner()
    serverQueue.push({
      data: {
        id: 555,
        amount_cents: null,
        currency: 'USD',
        status: 'pending',
        payout_method_kind: 'paypal',
        payout_method_target_masked: 'k***@example.com',
        created_at: '2026-06-26T08:00:00Z',
      },
      error: null,
    })
    const result = await getPendingPayoutRequest()
    expect(result).toBeNull()
  })

  it('returns null when status is not pending (defensive — DB CHECK enforces this)', async () => {
    enqueuePartner()
    serverQueue.push({
      data: {
        id: 555,
        amount_cents: 12500,
        currency: 'USD',
        status: 'approved',
        payout_method_kind: 'paypal',
        payout_method_target_masked: 'k***@example.com',
        created_at: '2026-06-26T08:00:00Z',
      },
      error: null,
    })
    const result = await getPendingPayoutRequest()
    expect(result).toBeNull()
  })

  it('returns null when payout_method_kind is not paypal (forward-compat — Slice 2 adds bank)', async () => {
    enqueuePartner()
    serverQueue.push({
      data: {
        id: 555,
        amount_cents: 12500,
        currency: 'USD',
        status: 'pending',
        payout_method_kind: 'bank',
        payout_method_target_masked: '****6789',
        created_at: '2026-06-26T08:00:00Z',
      },
      error: null,
    })
    const result = await getPendingPayoutRequest()
    expect(result).toBeNull()
  })

  it('returns null when payout_method_target_masked is missing', async () => {
    enqueuePartner()
    serverQueue.push({
      data: {
        id: 555,
        amount_cents: 12500,
        currency: 'USD',
        status: 'pending',
        payout_method_kind: 'paypal',
        payout_method_target_masked: null,
        created_at: '2026-06-26T08:00:00Z',
      },
      error: null,
    })
    const result = await getPendingPayoutRequest()
    expect(result).toBeNull()
  })
})

describe('getPendingPayoutRequest — PII safety', () => {
  it('never logs raw user_id, partner_id, or email', async () => {
    enqueuePartner(123)
    serverQueue.push({ data: null, error: { message: 'boom' } })
    await getPendingPayoutRequest()
    for (const call of logCalls) {
      const blob = JSON.stringify(call.payload) + ' ' + (call.msg ?? '')
      expect(blob).not.toContain('user_1')
      expect(blob).not.toContain('123')
      expect(blob).not.toContain('partner@example.com')
    }
  })
})