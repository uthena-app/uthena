// getAdminPartnerPayouts.test.ts — unit tests for the P6.8 Slice 1
// `getAdminPartnerPayouts` query.
//
// Covers:
//   - **Input validation (Zod)**: invalid partnerId (negative, zero,
//     non-numeric, NaN, empty string, malformed strings) → null
//     without hitting the DB.
//   - **Auth gating**: no session user → null + no DB calls;
//     non-admin role → null + no DB calls (requireRole throws).
//   - **Partner not found**: empty result → null (page renders 404).
//   - **Partner read error**: → null + warn log.
//   - **Happy path (full data)**: returns mapped partner + ledger
//     entries + summary aggregates + payout requests + display_name
//     fallback (display_name → public_slug → Partner #<id>).
//   - **Display name fallback**: profile missing / display_name
//     empty / public_slug missing → `Partner #<id>` fallback.
//   - **Defensive ledger mapping**: missing amount_cents / kind /
//     status → row dropped (not crashed; not surfaced half-mapped).
//   - **Defensive payout_request mapping**: missing currency /
//     bad status / wrong payout_method_kind → row dropped.
//   - **DB error on each secondary read**: ledger / requests / any
//     summary aggregate failing → warn + empty entries / empty
//     list / zero summary for the failed aggregate (fail-soft).
//   - **PII safety**: profiles select NEVER includes email / ip /
//     user_agent; partners select NEVER includes payout_method;
//     log payloads NEVER include raw partner_id / user_id / email.
//   - **Query shape**: ledger read orders by created_at desc + id
//     desc; payout_requests read orders by created_at desc + id
//     desc; ledger entries have partner_id filter; payout_requests
//     have partner_id filter.
//
// Pattern follows `getAdminPayoutRequests.test.ts` — chainable
// fake Supabase + queued results + Pino mock with log-call capture.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ----- Mocks ---------------------------------------------------------------

type ServerCall =
  | { method: 'from'; table: string; chainIndex: number }
  | { method: 'select'; payload: unknown; chainIndex: number }
  | { method: 'eq'; col: string; val: unknown; chainIndex: number }
  | { method: 'gt'; col: string; val: unknown; chainIndex: number }
  | { method: 'order'; col: string; ascending?: boolean | undefined; chainIndex: number }
  | { method: 'limit'; n: number; chainIndex: number }
  | { method: 'maybeSingle'; chainIndex: number }

const serverCalls: ServerCall[] = []
const chainQueues = new Map<number, Array<{ data: unknown; error: unknown }>>()
let chainCounter = 0

function makeServerChain() {
  // chainCounter is incremented here. The caller (from()) passes
  // chainIndex in via the closure — both should agree.
  const chainIndex = chainCounter++
  const queue = chainQueues.get(chainIndex) ?? []
  let resolved = false
  const chain: any = {
    select(payload: unknown) {
      serverCalls.push({ method: 'select', payload, chainIndex })
      return chain
    },
    eq(col: string, val: unknown) {
      serverCalls.push({ method: 'eq', col, val, chainIndex })
      return chain
    },
    gt(col: string, val: unknown) {
      serverCalls.push({ method: 'gt', col, val, chainIndex })
      return chain
    },
    order(col: string, opts?: { ascending?: boolean }) {
      const ascending = opts && 'ascending' in opts ? opts.ascending : undefined
      serverCalls.push({ method: 'order', col, ascending, chainIndex })
      return chain
    },
    limit(n: number) {
      serverCalls.push({ method: 'limit', n, chainIndex })
      return chain
    },
    maybeSingle: vi.fn(async () => {
      serverCalls.push({ method: 'maybeSingle', chainIndex })
      const value = await chain
      return { data: value.data, error: value.error }
    }),
    then(onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
      if (!resolved) {
        resolved = true
        const queued = queue.shift() ?? { data: null, error: null }
        const value = {
          data: queued.data,
          error: queued.error,
          count: (queued as { count?: number }).count ?? null,
        }
        return Promise.resolve(value).then(onFulfilled, onRejected)
      }
      return Promise.resolve({ data: null, error: null }).then(onFulfilled, onRejected)
    },
  }
  return chain
}

const fakeServiceSupabase = {
  from: vi.fn((table: string) => {
    // Create the queue for THIS chainIndex BEFORE makeServerChain
    // bumps the counter. The queue is keyed on the chainIndex that
    // makeServerChain will read. Only create if the test hasn't
    // already populated it via enqueue() — otherwise the test's
    // mocked data would be overwritten with an empty queue.
    const chainIndex = chainCounter
    if (!chainQueues.has(chainIndex)) {
      chainQueues.set(chainIndex, [])
    }
    serverCalls.push({ method: 'from', table, chainIndex })
    return makeServerChain()
  }),
}

/**
 * Push a queued result for the Nth chain (0-indexed). The test
 * sets up the queue BEFORE calling the query, so the chainIndex
 * ordering matches the order `from()` was called.
 *
 *   - chain 0: partners (Round 1)
 *   - chain 1: profiles (Round 2)
 *   - chain 2: payout_ledger summary - available
 *   - chain 3: payout_ledger summary - locked
 *   - chain 4: payout_ledger summary - paid
 *   - chain 5: payout_ledger next-release (maybeSingle)
 *   - chain 6: payout_ledger summary - pending_payout
 *   - chain 7: payout_ledger entries
 *   - chain 8: payout_requests
 */
function enqueue(chainIndex: number, data: unknown, error: unknown = null): void {
  let queue = chainQueues.get(chainIndex)
  if (!queue) {
    queue = []
    chainQueues.set(chainIndex, queue)
  }
  queue.push({ data, error })
}

/** Ensure chains 0..N exist with empty queues so the test can
 *  enqueue out of order without "No queue for chain N" errors. */
function ensureChains(n: number): void {
  for (let i = 0; i < n; i++) {
    if (!chainQueues.has(i)) chainQueues.set(i, [])
  }
}

vi.mock('@foundations/data/supabase', () => ({
  getServiceSupabase: vi.fn(() => fakeServiceSupabase),
}))

// ----- Logger mock (PII-safety assertions) ---------------------------------

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

// ----- Auth mocks ----------------------------------------------------------

let mockSessionUser: { id: string; email: string; role: string; display_name: string } | null = {
  id: 'admin_1',
  email: 'admin@example.com',
  role: 'admin',
  display_name: 'Admin',
}

vi.mock('@foundations/auth/guards', () => ({
  getSessionUser: vi.fn(async () => mockSessionUser),
  requireRole: vi.fn(async (roles: string[]) => {
    if (!mockSessionUser) {
      const err = new Error('not authenticated')
      ;(err as Error & { __notAuth?: boolean }).__notAuth = true
      throw err
    }
    if (!roles.includes(mockSessionUser.role)) {
      const err = new Error('forbidden')
      ;(err as Error & { __forbidden?: boolean }).__forbidden = true
      throw err
    }
    return mockSessionUser
  }),
}))

// ----- Helpers -------------------------------------------------------------

function resetAll(): void {
  serverCalls.length = 0
  chainQueues.clear()
  chainCounter = 0
  logCalls.length = 0
  mockSessionUser = {
    id: 'admin_1',
    email: 'admin@example.com',
    role: 'admin',
    display_name: 'Admin',
  }
  vi.clearAllMocks()
}

// Convenience: number of `from()` calls to a given table.
function countFromCalls(table: string): number {
  return serverCalls.filter((c) => c.method === 'from' && c.table === table).length
}

// Convenience: the select payload for the Nth chain on a given table.
// Returns the raw select string (cast to string for the assertion helpers).
function findSelectPayloadOnChain(chainIndex: number): string | null {
  const c = serverCalls.find(
    (call) => call.method === 'select' && call.chainIndex === chainIndex,
  )
  return c && c.method === 'select' ? String(c.payload) : null
}

// Convenience: find an `eq` call on a specific chain.
function findEqOnChain(
  chainIndex: number,
  col: string,
): { val: unknown } | undefined {
  for (const c of serverCalls) {
    if (c.method === 'eq' && c.chainIndex === chainIndex && c.col === col) {
      return { val: c.val }
    }
  }
  return undefined
}

// Find any eq across all chains.
function findAnyEq(col: string): { val: unknown; chainIndex: number } | undefined {
  for (const c of serverCalls) {
    if (c.method === 'eq' && c.col === col) {
      return { val: c.val, chainIndex: c.chainIndex }
    }
  }
  return undefined
}

// ----- Tests ---------------------------------------------------------------

beforeEach(resetAll)
afterEach(resetAll)

// ----- Import under test (after mocks) ------------------------------------

import { getAdminPartnerPayouts } from './getAdminPartnerPayouts'

// ----- Input validation ----------------------------------------------------

describe('getAdminPartnerPayouts — input validation', () => {
  it('returns null when partnerId is a non-numeric string', async () => {
    const result = await getAdminPartnerPayouts({ partnerId: 'abc' })
    expect(result).toBeNull()
    expect(serverCalls).toHaveLength(0)
  })

  it('returns null when partnerId is negative', async () => {
    const result = await getAdminPartnerPayouts({ partnerId: -1 })
    expect(result).toBeNull()
    expect(serverCalls).toHaveLength(0)
  })

  it('returns null when partnerId is zero', async () => {
    const result = await getAdminPartnerPayouts({ partnerId: 0 })
    expect(result).toBeNull()
    expect(serverCalls).toHaveLength(0)
  })

  it('returns null when partnerId is an empty string', async () => {
    const result = await getAdminPartnerPayouts({ partnerId: '' })
    expect(result).toBeNull()
    expect(serverCalls).toHaveLength(0)
  })

  it('returns null when partnerId is NaN', async () => {
    const result = await getAdminPartnerPayouts({ partnerId: Number.NaN })
    expect(result).toBeNull()
    expect(serverCalls).toHaveLength(0)
  })

  it('coerces numeric strings to numbers and accepts them', async () => {
    enqueue(0, null) // partners row → not found → null
    const result = await getAdminPartnerPayouts({ partnerId: '42' })
    expect(result).toBeNull()
  })
})

// ----- Auth gating ---------------------------------------------------------

describe('getAdminPartnerPayouts — auth gating', () => {
  it('returns null + no DB calls when no session user', async () => {
    mockSessionUser = null
    const result = await getAdminPartnerPayouts({ partnerId: 42 })
    expect(result).toBeNull()
    expect(serverCalls).toHaveLength(0)
  })

  it('returns null when role is not admin / super_admin', async () => {
    mockSessionUser = {
      id: 'partner_1',
      email: 'partner@example.com',
      role: 'partner',
      display_name: 'Partner',
    }
    const result = await getAdminPartnerPayouts({ partnerId: 42 })
    expect(result).toBeNull()
    expect(serverCalls).toHaveLength(0)
    // The log should mention forbidden + the hashed actor id.
    const warn = logCalls.find((l) => l.msg?.includes('forbidden role'))
    expect(warn).toBeDefined()
    // No raw email/user_id in any log payload.
    for (const c of logCalls) {
      expect(JSON.stringify(c.payload)).not.toContain('partner_1')
      expect(JSON.stringify(c.payload)).not.toContain('partner@example.com')
    }
  })

  it('returns null + no DB calls when super_admin role check passes but no session', async () => {
    mockSessionUser = null
    const result = await getAdminPartnerPayouts({ partnerId: 42 })
    expect(result).toBeNull()
    expect(serverCalls).toHaveLength(0)
  })
})

// ----- Partner read --------------------------------------------------------

describe('getAdminPartnerPayouts — partner row', () => {
  it('returns null when partner row not found', async () => {
    enqueue(0, null) // partners row → not found
    const result = await getAdminPartnerPayouts({ partnerId: 999 })
    expect(result).toBeNull()
    expect(countFromCalls('partners')).toBe(1)
  })

  it('returns null when partner read errors', async () => {
    enqueue(0, null, { message: 'db down' })
    const result = await getAdminPartnerPayouts({ partnerId: 42 })
    expect(result).toBeNull()
    const warn = logCalls.find((l) => l.msg?.includes('partner row read failed'))
    expect(warn).toBeDefined()
  })
})

// ----- Happy path ----------------------------------------------------------
//
// Per-chain enqueue map (chainIndex → what it represents):
//   0 = partners (Round 1)
//   1 = profiles
//   2 = payout_ledger summary - available
//   3 = payout_ledger summary - locked
//   4 = payout_ledger summary - paid
//   5 = payout_ledger next-release (maybeSingle)
//   6 = payout_ledger summary - pending_payout
//   7 = payout_ledger entries
//   8 = payout_requests

describe('getAdminPartnerPayouts — happy path', () => {
  function pushHappyQueues(opts: {
    display_name?: string | null
    partnerOverrides?: Record<string, unknown>
    ledgerRows?: unknown[]
    requestRows?: unknown[]
  } = {}) {
    enqueue(0, {
      id: 42,
      user_id: 'user_uuid_42',
      status: 'approved',
      public_slug: 'cool-partner',
      royalty_pct_bps: 1500,
      approved_at: '2026-01-15T10:00:00Z',
      created_at: '2026-01-01T00:00:00Z',
      ...opts.partnerOverrides,
    })
    enqueue(1, {
      user_id: 'user_uuid_42',
      display_name: opts.display_name ?? 'Cool Partner',
      role: 'partner',
      status: 'active',
      timezone: 'America/Los_Angeles',
      avatar_url: null,
    })
    enqueue(2, [{ amount_cents: 5000 }, { amount_cents: 3500 }])
    enqueue(3, [{ amount_cents: 1200 }])
    enqueue(4, [{ amount_cents: 8000 }, { amount_cents: 4000 }])
    enqueue(5, { available_at: '2026-07-15T00:00:00Z' })
    enqueue(6, [{ amount_cents: 2500 }])
    enqueue(
      7,
      opts.ledgerRows ?? [
        {
          id: 1,
          created_at: '2026-06-20T10:00:00Z',
          kind: 'order_sale',
          status: 'available',
          amount_cents: 5000,
          currency: 'USD',
          description: 'Order #100 sale',
          order_id: 100,
          order_item_id: 1000,
          refund_id: null,
          royalty_pct_bps: 1500,
          locked_until: '2026-07-04T10:00:00Z',
          available_at: '2026-07-04T10:00:00Z',
          paid_at: null,
          paypal_payout_batch_id: null,
          stripe_transfer_id: null,
        },
      ],
    )
    enqueue(
      8,
      opts.requestRows ?? [
        {
          id: 50,
          partner_id: 42,
          amount_cents: 5000,
          currency: 'USD',
          status: 'pending',
          payout_method_kind: 'paypal',
          payout_method_target_masked: 'k***@example.com',
          denial_reason: null,
          processed_at: null,
          created_at: '2026-06-20T10:00:00Z',
          updated_at: '2026-06-20T10:00:00Z',
        },
      ],
    )
  }

  it('returns mapped partner + ledger + summary + requests', async () => {
    pushHappyQueues()
    const result = await getAdminPartnerPayouts({ partnerId: 42 })
    expect(result).not.toBeNull()
    expect(result!.partner).toEqual({
      id: 42,
      user_id: 'user_uuid_42',
      display_name: 'Cool Partner',
      status: 'approved',
      public_slug: 'cool-partner',
      royalty_pct_bps: 1500,
      approved_at: '2026-01-15T10:00:00Z',
      created_at: '2026-01-01T00:00:00Z',
    })
    expect(result!.ledger.entries).toHaveLength(1)
    expect(result!.ledger.entries[0]).toMatchObject({
      id: 1,
      kind: 'order_sale',
      status: 'available',
      amount_cents: 5000,
      currency: 'USD',
    })
    expect(result!.ledger.summary).toEqual({
      available_cents: 8500, // 5000 + 3500
      locked_cents: 1200,
      paid_cents: 12000, // 8000 + 4000
      lifetime_earned_cents: 21700,
      next_release_at: '2026-07-15T00:00:00Z',
      pending_payout_cents: 2500,
    })
    expect(result!.payoutRequests).toHaveLength(1)
    expect(result!.payoutRequests[0]).toMatchObject({
      id: 50,
      partner_id: 42,
      amount_cents: 5000,
      status: 'pending',
      payout_method_target_masked: 'k***@example.com',
    })
  })

  it('falls back display_name to public_slug when profile.display_name is empty', async () => {
    pushHappyQueues({ display_name: '' })
    const result = await getAdminPartnerPayouts({ partnerId: 42 })
    expect(result!.partner.display_name).toBe('cool-partner')
  })

  it('falls back display_name to "Partner #<id>" when both display_name and public_slug are missing', async () => {
    pushHappyQueues({
      partnerOverrides: { public_slug: null, royalty_pct_bps: null, approved_at: null },
      display_name: '',
    })
    const result = await getAdminPartnerPayouts({ partnerId: 42 })
    expect(result!.partner.display_name).toBe('Partner #42')
  })

  it('queries partners with the right select columns (PII-safe)', async () => {
    pushHappyQueues()
    await getAdminPartnerPayouts({ partnerId: 42 })
    const payload = findSelectPayloadOnChain(0)
    expect(payload).not.toBeNull()
    expect(payload).not.toContain('email')
    expect(payload).not.toContain('payout_method')
    expect(payload).not.toContain('tax_id')
  })

  it('queries profiles with the right select columns (PII-safe)', async () => {
    pushHappyQueues()
    await getAdminPartnerPayouts({ partnerId: 42 })
    const payload = findSelectPayloadOnChain(1)
    expect(payload).not.toBeNull()
    expect(payload).not.toContain('email')
    expect(payload).not.toContain('user_agent')
    expect(payload).not.toContain('ip ')
    expect(payload).toContain('display_name')
  })

  it('filters ledger + requests by partner_id', async () => {
    pushHappyQueues()
    await getAdminPartnerPayouts({ partnerId: 42 })
    // Ledger chain is chain 7, requests chain is chain 8.
    const ledgerPartnerId = findEqOnChain(7, 'partner_id')
    const requestsPartnerId = findEqOnChain(8, 'partner_id')
    expect(ledgerPartnerId?.val).toBe(42)
    expect(requestsPartnerId?.val).toBe(42)
  })
})

// ----- Defensive mapping ---------------------------------------------------

describe('getAdminPartnerPayouts — defensive mapping', () => {
  function pushSuccessSetup() {
    enqueue(0, {
      id: 42,
      user_id: 'user_uuid_42',
      status: 'approved',
      public_slug: 'cool-partner',
      royalty_pct_bps: 1500,
      approved_at: '2026-01-15T10:00:00Z',
      created_at: '2026-01-01T00:00:00Z',
    })
    enqueue(1, {
      user_id: 'user_uuid_42',
      display_name: 'Cool Partner',
      role: 'partner',
      status: 'active',
      timezone: 'UTC',
      avatar_url: null,
    })
    enqueue(2, [])
    enqueue(3, [])
    enqueue(4, [])
    enqueue(5, null)
    enqueue(6, [])
  }

  it('drops ledger rows with missing amount_cents', async () => {
    pushSuccessSetup()
    enqueue(7, [
      {
        id: 1,
        created_at: '2026-06-20T10:00:00Z',
        kind: 'order_sale',
        status: 'available',
        amount_cents: null, // bad
        currency: 'USD',
        description: null,
        order_id: null,
        order_item_id: null,
        refund_id: null,
        royalty_pct_bps: null,
        locked_until: null,
        available_at: null,
        paid_at: null,
        paypal_payout_batch_id: null,
        stripe_transfer_id: null,
      },
    ])
    enqueue(8, [])

    const result = await getAdminPartnerPayouts({ partnerId: 42 })
    expect(result!.ledger.entries).toHaveLength(0)
    const warn = logCalls.find((l) => l.msg?.includes('dropping ledger row'))
    expect(warn).toBeDefined()
  })

  it('drops payout_request rows with wrong payout_method_kind', async () => {
    pushSuccessSetup()
    enqueue(7, [])
    enqueue(8, [
      {
        id: 50,
        partner_id: 42,
        amount_cents: 5000,
        currency: 'USD',
        status: 'pending',
        payout_method_kind: 'bank', // bad — v1 only supports paypal
        payout_method_target_masked: '****1234',
        denial_reason: null,
        processed_at: null,
        created_at: '2026-06-20T10:00:00Z',
        updated_at: '2026-06-20T10:00:00Z',
      },
    ])

    const result = await getAdminPartnerPayouts({ partnerId: 42 })
    expect(result!.payoutRequests).toHaveLength(0)
    const warn = logCalls.find((l) => l.msg?.includes('dropping payout_request row'))
    expect(warn).toBeDefined()
  })

  it('drops payout_request rows with unknown status', async () => {
    pushSuccessSetup()
    enqueue(7, [])
    enqueue(8, [
      {
        id: 50,
        partner_id: 42,
        amount_cents: 5000,
        currency: 'USD',
        status: 'weird_status', // bad — not in PAYOUT_REQUEST_STATUS_VALUES
        payout_method_kind: 'paypal',
        payout_method_target_masked: 'k***@example.com',
        denial_reason: null,
        processed_at: null,
        created_at: '2026-06-20T10:00:00Z',
        updated_at: '2026-06-20T10:00:00Z',
      },
    ])

    const result = await getAdminPartnerPayouts({ partnerId: 42 })
    expect(result!.payoutRequests).toHaveLength(0)
  })
})

// ----- DB error fail-soft --------------------------------------------------

describe('getAdminPartnerPayouts — DB error fail-soft', () => {
  function pushSuccessSetup() {
    enqueue(0, {
      id: 42,
      user_id: 'user_uuid_42',
      status: 'approved',
      public_slug: 'cool-partner',
      royalty_pct_bps: 1500,
      approved_at: '2026-01-15T10:00:00Z',
      created_at: '2026-01-01T00:00:00Z',
    })
    enqueue(1, {
      user_id: 'user_uuid_42',
      display_name: 'Cool Partner',
      role: 'partner',
      status: 'active',
      timezone: 'UTC',
      avatar_url: null,
    })
  }

  it('returns empty ledger entries when ledger read errors', async () => {
    pushSuccessSetup()
    enqueue(2, [])
    enqueue(3, [])
    enqueue(4, [])
    enqueue(5, null)
    enqueue(6, [])
    enqueue(7, null, { message: 'ledger table missing' })
    enqueue(8, [])
    const result = await getAdminPartnerPayouts({ partnerId: 42 })
    expect(result!.ledger.entries).toEqual([])
    const warn = logCalls.find((l) => l.msg?.includes('ledger read failed'))
    expect(warn).toBeDefined()
  })

  it('returns empty payoutRequests when requests read errors', async () => {
    pushSuccessSetup()
    enqueue(2, [])
    enqueue(3, [])
    enqueue(4, [])
    enqueue(5, null)
    enqueue(6, [])
    enqueue(7, [])
    enqueue(8, null, { message: 'requests table missing' })
    const result = await getAdminPartnerPayouts({ partnerId: 42 })
    expect(result!.payoutRequests).toEqual([])
    const warn = logCalls.find((l) => l.msg?.includes('payout_requests read failed'))
    expect(warn).toBeDefined()
  })

  it('returns zero summary aggregates when one summary read errors (warn, do not throw)', async () => {
    pushSuccessSetup()
    enqueue(2, null, { message: 'available aggregate failed' })
    enqueue(3, [])
    enqueue(4, [])
    enqueue(5, null)
    enqueue(6, [])
    enqueue(7, [])
    enqueue(8, [])
    const result = await getAdminPartnerPayouts({ partnerId: 42 })
    expect(result!.ledger.summary.available_cents).toBe(0)
    const warn = logCalls.find((l) => l.msg?.includes('summary aggregate reads failed'))
    expect(warn).toBeDefined()
  })
})

// ----- PII safety ----------------------------------------------------------

describe('getAdminPartnerPayouts — PII safety', () => {
  it('never includes raw user_uuid / email in any log payload', async () => {
    enqueue(0, {
      id: 42,
      user_id: 'user_uuid_42',
      status: 'approved',
      public_slug: 'cool-partner',
      royalty_pct_bps: 1500,
      approved_at: '2026-01-15T10:00:00Z',
      created_at: '2026-01-01T00:00:00Z',
    })
    enqueue(1, {
      user_id: 'user_uuid_42',
      display_name: 'Cool Partner',
      role: 'partner',
      status: 'active',
      timezone: 'UTC',
      avatar_url: null,
    })
    enqueue(2, [])
    enqueue(3, [])
    enqueue(4, [])
    enqueue(5, null)
    enqueue(6, [])
    enqueue(7, [])
    enqueue(8, [])

    await getAdminPartnerPayouts({ partnerId: 42 })

    for (const call of logCalls) {
      const payload = JSON.stringify(call.payload)
      expect(payload).not.toContain('user_uuid_42')
      expect(payload).not.toContain('admin@example.com')
    }
  })
})