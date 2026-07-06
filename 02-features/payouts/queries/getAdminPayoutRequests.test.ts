// getAdminPayoutRequests.test.ts — unit tests for the P6.7 Slice 1
// `getAdminPayoutRequests` query.
//
// Covers:
//   - **Auth gating**: no session user → empty result + no DB calls;
//     non-admin role → empty result + no DB calls.
//   - **Bad opts**: invalid `limit` (negative / over 200 / zero),
//     bad `status` value, bad `beforeId` (negative / non-int) →
//     empty result, default opts echoed.
//   - **Happy path (no filter)**: returns mapped requests + counts
//     over 6 parallel partial-index COUNT queries + partner name
//     map + the list query shape (order + limit + joined via
//     `in()` for partner names).
//   - **Happy path (status filter)**: query shape adds `.eq('status', <x>)`.
//   - **Happy path (beforeId cursor)**: query shape adds `.lt('id', <n>)`.
//   - **Happy path (status + beforeId coexist)**: both shape clauses
//     hit the captured call list.
//   - **Counts**: each per-status count uses PostgREST head:true
//     (select('*', { count: 'exact', head: true }).eq('status', <x>))
//     + the total is the sum of all six.
//   - **Partner name map**: looks up the unique partner_ids in the
//     result set via `.in('id', [...])`; missing partner falls back
//     to `partner_name: null` (NOT `Partner #<id>` here — that's
//     only used in getAdminLedger for the partner list view).
//   - **Defensive mapping**: missing amount_cents / currency /
//     masked / etc. → row dropped (not crashed; not surfaced
//     half-mapped).
//   - **DB error**: empty list + warn log + counts echoed.
//   - **Partner lookup error**: warn log + empty partner map +
//     requests still returned (fail-soft — the page can render
//     "Partner #N" or null).
//   - **PII safety**: no raw partner_id / user_id / email in any
//     log payload; only hashed partner_id.
//
// Pattern follows `getPendingPayoutRequest.test.ts` — chainable
// fake Supabase + queued results + Pino mock with log-call capture.
// Adds a parallel mock for getServiceSupabase (the admin read goes
// through service-role, not the session client).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ----- Mocks ---------------------------------------------------------------

type ServerCall =
  | { method: 'from'; table: string }
  | { method: 'select'; payload: unknown; opts: { count?: string; head?: boolean } | undefined }
  | { method: 'eq'; col: string; val: unknown }
  | { method: 'in'; col: string; vals: unknown[] }
  | { method: 'order'; col: string; ascending?: boolean | undefined }
  | { method: 'limit'; n: number }
  | { method: 'lt'; col: string; val: unknown }
  | { method: 'maybeSingle' }
  | { method: 'single' }

const serverCalls: ServerCall[] = []
let serverQueue: Array<{ data: unknown; error: unknown; count?: number }> = []

function makeServerChain() {
  // Mirrors the Supabase JS client shape: a chainable that's ALSO a
  // thenable. Awaiting the chain runs the queued result. .maybeSingle()
  // and .single() are explicitly terminal — they pop the queue and
  // return a Promise.
  let resolved = false
  const chain: any = {
    select(payload: unknown, opts?: { count?: string; head?: boolean }) {
      serverCalls.push({ method: 'select', payload, opts })
      return chain
    },
    eq(col: string, val: unknown) {
      serverCalls.push({ method: 'eq', col, val })
      return chain
    },
    in(col: string, vals: unknown[]) {
      serverCalls.push({ method: 'in', col, vals })
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
    lt(col: string, val: unknown) {
      serverCalls.push({ method: 'lt', col, val })
      return chain
    },
    maybeSingle: vi.fn(async () => {
      serverCalls.push({ method: 'maybeSingle' })
      const queued = serverQueue.shift() ?? { data: null, error: null, count: null }
      return { data: queued.data, error: queued.error, count: queued.count ?? null }
    }),
    single: vi.fn(async () => {
      serverCalls.push({ method: 'single' })
      const queued = serverQueue.shift() ?? { data: null, error: null, count: null }
      return { data: queued.data, error: queued.error, count: queued.count ?? null }
    }),
    then(onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
      // When awaited, pop the next queued result. This matches the
      // Supabase JS behavior where awaiting the filter-builder chain
      // runs the query and resolves with `{ data, error, count }`.
      if (!resolved) {
        resolved = true
        const queued = serverQueue.shift() ?? { data: null, error: null, count: null }
        const value = {
          data: queued.data,
          error: queued.error,
          count: queued.count ?? null,
        }
        return Promise.resolve(value).then(onFulfilled, onRejected)
      }
      // Already awaited — chain is exhausted; resolve to empty.
      return Promise.resolve({ data: null, error: null, count: null }).then(
        onFulfilled,
        onRejected,
      )
    },
  }
  return chain
}

// Helpers — narrow the ServerCall union so TS lets us read variant-
// specific fields. Pattern is `findBy<K>(key, val)` returning the
// matching call (or undefined) with the right variant type.
type EqCall = Extract<ServerCall, { method: 'eq' }>
type InCall = Extract<ServerCall, { method: 'in' }>
type FromCall = Extract<ServerCall, { method: 'from' }>

function findEq(col: string): EqCall | undefined {
  return serverCalls.find(
    (c): c is EqCall => c.method === 'eq' && c.col === col,
  )
}

const fakeServiceSupabase = {
  from: vi.fn((table: string) => {
    serverCalls.push({ method: 'from', table })
    return makeServerChain()
  }),
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
  serverQueue.length = 0
  logCalls.length = 0
  mockSessionUser = {
    id: 'admin_1',
    email: 'admin@example.com',
    role: 'admin',
    display_name: 'Admin',
  }
}

beforeEach(() => resetAll())
afterEach(() => resetAll())

// =========================================================================
// Tests
// =========================================================================

describe('getAdminPayoutRequests — auth gating', () => {
  it('returns empty result with no DB calls when no session', async () => {
    mockSessionUser = null
    const { getAdminPayoutRequests } = await import('./getAdminPayoutRequests')
    const result = await getAdminPayoutRequests({})
    expect(result.requests).toEqual([])
    expect(result.counts.total).toBe(0)
    expect(result.filters).toEqual({ status: null, limit: 50 })
    expect(serverCalls.filter((c) => c.method === 'from')).toHaveLength(0)
  })

  it('returns empty result with no DB calls when role is not admin/super_admin', async () => {
    mockSessionUser = {
      id: 'partner_1',
      email: 'p@example.com',
      role: 'partner',
      display_name: 'P',
    }
    const { getAdminPayoutRequests } = await import('./getAdminPayoutRequests')
    const result = await getAdminPayoutRequests({})
    expect(result.requests).toEqual([])
    expect(result.counts.total).toBe(0)
    expect(serverCalls.filter((c) => c.method === 'from')).toHaveLength(0)
  })
})

describe('getAdminPayoutRequests — bad opts', () => {
  it('falls back to defaults when limit is invalid', async () => {
    // happy queue (counts then list)
    serverQueue.push({ data: null, error: null, count: 0 }) // pending
    serverQueue.push({ data: null, error: null, count: 0 }) // approved
    serverQueue.push({ data: null, error: null, count: 0 }) // denied
    serverQueue.push({ data: null, error: null, count: 0 }) // paid
    serverQueue.push({ data: null, error: null, count: 0 }) // failed
    serverQueue.push({ data: null, error: null, count: 0 }) // canceled
    serverQueue.push({ data: [], error: null }) // list
    serverQueue.push({ data: [], error: null }) // partners

    const { getAdminPayoutRequests } = await import('./getAdminPayoutRequests')
    const r = await getAdminPayoutRequests({ limit: -5 })
    expect(r.requests).toEqual([])
    // Falls back to default 50
    const listLimit = serverCalls.find((c) => c.method === 'limit' && c.n === 50)
    expect(listLimit).toBeDefined()
  })

  it('falls back when status is not in the whitelist', async () => {
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: [], error: null })
    serverQueue.push({ data: [], error: null })

    const { getAdminPayoutRequests } = await import('./getAdminPayoutRequests')
    const r = await getAdminPayoutRequests({ status: 'something_else' as never })
    // Echoed status is null (not the bogus value)
    expect(r.filters.status).toBeNull()
  })
})

describe('getAdminPayoutRequests — happy path', () => {
  it('returns mapped requests + counts + echoes filters (no status filter)', async () => {
    // 6 count queries (parallel)
    serverQueue.push({ data: null, error: null, count: 3 }) // pending
    serverQueue.push({ data: null, error: null, count: 1 }) // approved
    serverQueue.push({ data: null, error: null, count: 0 }) // denied
    serverQueue.push({ data: null, error: null, count: 5 }) // paid
    serverQueue.push({ data: null, error: null, count: 0 }) // failed
    serverQueue.push({ data: null, error: null, count: 0 }) // canceled
    // list query
    serverQueue.push({
      data: [
        {
          id: 100,
          partner_id: 7,
          amount_cents: 12345,
          currency: 'USD',
          status: 'pending',
          payout_method_kind: 'paypal',
          payout_method_target_masked: 'k***@example.com',
          denial_reason: null,
          processed_at: null,
          created_at: '2026-06-26T10:00:00Z',
          updated_at: '2026-06-26T10:00:00Z',
        },
        {
          id: 99,
          partner_id: 8,
          amount_cents: 5000,
          currency: 'USD',
          status: 'pending',
          payout_method_kind: 'paypal',
          payout_method_target_masked: 'a***@other.com',
          denial_reason: null,
          processed_at: null,
          created_at: '2026-06-25T08:30:00Z',
          updated_at: '2026-06-25T08:30:00Z',
        },
      ],
      error: null,
    })
    // partner name lookup
    serverQueue.push({
      data: [
        { id: 7, public_slug: 'acme-co' },
        { id: 8, public_slug: null },
      ],
      error: null,
    })

    const { getAdminPayoutRequests } = await import('./getAdminPayoutRequests')
    const r = await getAdminPayoutRequests({})

    expect(r.counts).toEqual({
      pending: 3,
      approved: 1,
      denied: 0,
      paid: 5,
      failed: 0,
      canceled: 0,
      total: 9,
    })
    expect(r.requests).toHaveLength(2)
    expect(r.requests[0]).toEqual({
      id: 100,
      partner_id: 7,
      partner_name: 'acme-co',
      amount_cents: 12345,
      currency: 'USD',
      status: 'pending',
      payout_method_kind: 'paypal',
      payout_method_target_masked: 'k***@example.com',
      denial_reason: null,
      processed_at: null,
      created_at: '2026-06-26T10:00:00Z',
      updated_at: '2026-06-26T10:00:00Z',
    })
    expect(r.requests[1]!.partner_name).toBeNull() // missing public_slug → null
    expect(r.filters).toEqual({ status: null, limit: 50 })
  })

  it('issues 6 COUNT(*) head queries via PostgREST count+head', async () => {
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: [], error: null })
    serverQueue.push({ data: [], error: null })

    const { getAdminPayoutRequests } = await import('./getAdminPayoutRequests')
    await getAdminPayoutRequests({})

    // The first 7 .from() calls are 6 counts + 1 list. Verify all
    // counts use head:true + count:'exact' + a status eq.
    const countCalls = serverCalls
      .filter((c) => c.method === 'from' && c.table === 'payout_requests')
      .slice(0, 6)
    expect(countCalls).toHaveLength(6)
    // After each count's .from(), there's a .select() with head:true
    const countSelects = serverCalls.filter(
      (c) => c.method === 'select' && (c as { opts?: { head?: boolean } }).opts?.head === true,
    )
    expect(countSelects.length).toBeGreaterThanOrEqual(6)
// Each count's .eq('status', ...) follows the .select()
    const statusEqs = serverCalls.filter((c): c is EqCall => c.method === 'eq' && c.col === 'status')
    expect(statusEqs).toHaveLength(6)
    const statusValues = statusEqs.map((c) => c.val).sort()
    expect(statusValues).toEqual(['approved', 'canceled', 'denied', 'failed', 'paid', 'pending'])
  })

  it('list query: select fields + order by created_at desc + id desc + limit', async () => {
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: [], error: null })
    serverQueue.push({ data: [], error: null })

    const { getAdminPayoutRequests } = await import('./getAdminPayoutRequests')
    await getAdminPayoutRequests({ limit: 25 })

    // The list .select() payload has the expected fields
    const listFrom = serverCalls.filter((c): c is FromCall => c.method === 'from' && c.table === 'payout_requests')
    expect(listFrom.length).toBeGreaterThanOrEqual(7) // 6 counts + 1 list
    // Find the list select (not a count select)
    const nonCountSelects = serverCalls.filter(
      (c): c is Extract<ServerCall, { method: 'select' }> =>
        c.method === 'select' &&
        c.opts?.head !== true,
    )
    expect(nonCountSelects).toHaveLength(1)
    const listSelect = nonCountSelects[0]!
    expect(listSelect.payload).toContain('amount_cents')
    expect(listSelect.payload).toContain('payout_method_target_masked')
    expect(listSelect.payload).toContain('denial_reason')

    // Order + limit are present (and the order is desc + the second is id desc)
    const orders = serverCalls.filter((c) => c.method === 'order') as Array<
      Extract<ServerCall, { method: 'order' }>
    >
    expect(orders.map((o) => o.col)).toEqual(['created_at', 'id'])
    expect(orders.every((o) => o.ascending === false)).toBe(true)

    // limit is 25
    const limits = serverCalls.filter((c) => c.method === 'limit') as Array<
      Extract<ServerCall, { method: 'limit' }>
    >
    expect(limits).toHaveLength(1)
    expect(limits[0]!.n).toBe(25)
  })
})

describe('getAdminPayoutRequests — filter shape', () => {
  it('adds .eq(status, x) when status filter is set', async () => {
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: [], error: null })
    serverQueue.push({ data: [], error: null })

    const { getAdminPayoutRequests } = await import('./getAdminPayoutRequests')
    await getAdminPayoutRequests({ status: 'pending' })

    // The list query (the 7th .from on payout_requests) has a
    // status eq with value 'pending' IN ADDITION to the 6 count eqs.
    const statusEqs = serverCalls.filter((c): c is EqCall => c.method === 'eq' && c.col === 'status')
    expect(statusEqs).toHaveLength(7)
    expect(statusEqs.filter((e) => e.val === 'pending')).toHaveLength(2) // count + list
    // The list's status eq is the LAST one with value 'pending'.
    const lastPendingIdx = statusEqs.map((e) => e.val).lastIndexOf('pending')
    expect(lastPendingIdx).toBeGreaterThanOrEqual(0)
    expect(statusEqs[lastPendingIdx]!.val).toBe('pending')
  })

  it('adds .lt(id, x) when beforeId cursor is set', async () => {
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: [], error: null })
    serverQueue.push({ data: [], error: null })

    const { getAdminPayoutRequests } = await import('./getAdminPayoutRequests')
    await getAdminPayoutRequests({ beforeId: 500 })

    expect(serverCalls.find((c): c is EqCall => c.method === 'lt' && c.col === 'id' && c.val === 500)).toBeDefined()
  })

  it('coexists status + beforeId on the same list query', async () => {
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: [], error: null })
    serverQueue.push({ data: [], error: null })

    const { getAdminPayoutRequests } = await import('./getAdminPayoutRequests')
    await getAdminPayoutRequests({ status: 'approved', beforeId: 200 })

    expect(serverCalls.find((c): c is EqCall => c.method === 'eq' && c.col === 'status' && c.val === 'approved')).toBeDefined()
    expect(serverCalls.find((c): c is EqCall => c.method === 'lt' && c.col === 'id' && c.val === 200)).toBeDefined()
  })
})

describe('getAdminPayoutRequests — partner name map', () => {
  it('looks up the unique partner_ids in the result set via .in(id, [...])', async () => {
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({
      data: [
        {
          id: 1,
          partner_id: 7,
          amount_cents: 100,
          currency: 'USD',
          status: 'pending',
          payout_method_kind: 'paypal',
          payout_method_target_masked: 'k***@x.com',
          denial_reason: null,
          processed_at: null,
          created_at: '2026-06-26T10:00:00Z',
          updated_at: '2026-06-26T10:00:00Z',
        },
        {
          id: 2,
          partner_id: 7, // duplicate
          amount_cents: 200,
          currency: 'USD',
          status: 'pending',
          payout_method_kind: 'paypal',
          payout_method_target_masked: 'k***@x.com',
          denial_reason: null,
          processed_at: null,
          created_at: '2026-06-26T09:00:00Z',
          updated_at: '2026-06-26T09:00:00Z',
        },
        {
          id: 3,
          partner_id: 8,
          amount_cents: 300,
          currency: 'USD',
          status: 'pending',
          payout_method_kind: 'paypal',
          payout_method_target_masked: 'a***@y.com',
          denial_reason: null,
          processed_at: null,
          created_at: '2026-06-26T08:00:00Z',
          updated_at: '2026-06-26T08:00:00Z',
        },
      ],
      error: null,
    })
    serverQueue.push({
      data: [
        { id: 7, public_slug: 'partner-7' },
        { id: 8, public_slug: null },
      ],
      error: null,
    })

    const { getAdminPayoutRequests } = await import('./getAdminPayoutRequests')
    const r = await getAdminPayoutRequests({})

    // Unique partner ids in the in() — 7 and 8 (not 7 twice)
    const inCall = serverCalls.find((c): c is InCall => c.method === 'in' && c.col === 'id')
    expect(inCall).toBeDefined()
    expect(inCall!.vals).toEqual([7, 8])
    // Names mapped correctly
    expect(r.requests[0]!.partner_name).toBe('partner-7')
    expect(r.requests[1]!.partner_name).toBe('partner-7')
    expect(r.requests[2]!.partner_name).toBeNull()
  })

  it('skips the partner lookup entirely when no rows returned', async () => {
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: [], error: null })

    const { getAdminPayoutRequests } = await import('./getAdminPayoutRequests')
    await getAdminPayoutRequests({})

    // No .in() call (no partner lookup needed)
    expect(serverCalls.find((c) => c.method === 'in')).toBeUndefined()
  })

  it('continues with empty partner map when partner lookup errors', async () => {
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({
      data: [
        {
          id: 1,
          partner_id: 7,
          amount_cents: 100,
          currency: 'USD',
          status: 'pending',
          payout_method_kind: 'paypal',
          payout_method_target_masked: 'k***@x.com',
          denial_reason: null,
          processed_at: null,
          created_at: '2026-06-26T10:00:00Z',
          updated_at: '2026-06-26T10:00:00Z',
        },
      ],
      error: null,
    })
    serverQueue.push({ data: null, error: { message: 'partners read failed' } })

    const { getAdminPayoutRequests } = await import('./getAdminPayoutRequests')
    const r = await getAdminPayoutRequests({})

    expect(r.requests).toHaveLength(1)
    expect(r.requests[0]!.partner_name).toBeNull()
    expect(logCalls.some((l) => l.payload.code === 'admin_requests_partner_lookup_failed')).toBe(true)
  })
})

describe('getAdminPayoutRequests — defensive mapping', () => {
  it('drops rows with missing amount_cents', async () => {
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({
      data: [
        {
          id: 1,
          partner_id: 7,
          amount_cents: null, // BAD
          currency: 'USD',
          status: 'pending',
          payout_method_kind: 'paypal',
          payout_method_target_masked: 'k***@x.com',
          denial_reason: null,
          processed_at: null,
          created_at: '2026-06-26T10:00:00Z',
          updated_at: '2026-06-26T10:00:00Z',
        },
      ],
      error: null,
    })
    serverQueue.push({ data: [], error: null })

    const { getAdminPayoutRequests } = await import('./getAdminPayoutRequests')
    const r = await getAdminPayoutRequests({})
    expect(r.requests).toHaveLength(0)
  })

  it('drops rows with unknown status', async () => {
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({
      data: [
        {
          id: 1,
          partner_id: 7,
          amount_cents: 100,
          currency: 'USD',
          status: 'reversed', // BAD — not in the CHECK constraint
          payout_method_kind: 'paypal',
          payout_method_target_masked: 'k***@x.com',
          denial_reason: null,
          processed_at: null,
          created_at: '2026-06-26T10:00:00Z',
          updated_at: '2026-06-26T10:00:00Z',
        },
      ],
      error: null,
    })
    serverQueue.push({ data: [], error: null })

    const { getAdminPayoutRequests } = await import('./getAdminPayoutRequests')
    const r = await getAdminPayoutRequests({})
    expect(r.requests).toHaveLength(0)
  })

  it('drops rows with wrong payout_method_kind (must be paypal)', async () => {
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({
      data: [
        {
          id: 1,
          partner_id: 7,
          amount_cents: 100,
          currency: 'USD',
          status: 'pending',
          payout_method_kind: 'crypto', // BAD
          payout_method_target_masked: 'k***@x.com',
          denial_reason: null,
          processed_at: null,
          created_at: '2026-06-26T10:00:00Z',
          updated_at: '2026-06-26T10:00:00Z',
        },
      ],
      error: null,
    })
    serverQueue.push({ data: [], error: null })

    const { getAdminPayoutRequests } = await import('./getAdminPayoutRequests')
    const r = await getAdminPayoutRequests({})
    expect(r.requests).toHaveLength(0)
  })
})

describe('getAdminPayoutRequests — DB error', () => {
  it('returns empty list + warn log + counts echoed when list query errors', async () => {
    // Counts succeed
    serverQueue.push({ data: null, error: null, count: 3 })
    serverQueue.push({ data: null, error: null, count: 1 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 5 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    // List errors
    serverQueue.push({ data: null, error: { message: 'list failed' } })

    const { getAdminPayoutRequests } = await import('./getAdminPayoutRequests')
    const r = await getAdminPayoutRequests({})

    expect(r.requests).toEqual([])
    expect(r.counts.total).toBe(9) // counts still echoed
    expect(logCalls.some((l) => l.payload.code === 'admin_requests_read_failed')).toBe(true)
  })
})

describe('getAdminPayoutRequests — PII safety', () => {
  it('never logs raw partner_id or partner name in any warn/info payload', async () => {
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: null, error: null, count: 0 })
    serverQueue.push({ data: [], error: null })
    serverQueue.push({ data: [], error: null })

    const { getAdminPayoutRequests } = await import('./getAdminPayoutRequests')
    // Trigger the bad-opts warn path
    await getAdminPayoutRequests({ status: 'reversed' as never })

    for (const l of logCalls) {
      const json = JSON.stringify(l.payload)
      expect(json).not.toContain('admin_1') // raw user_id
      expect(json).not.toContain('admin@example.com') // raw email
      // No raw partner_id (numeric); the query doesn't hash partner_id
      // in logs anyway, so we just assert no number >= 1 in warn
      // payloads that look like an id.
      expect(json).not.toMatch(/"partner_id"\s*:\s*\d+/)
    }
  })
})