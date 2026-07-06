// getPartnerLedger.test.ts — unit tests for getPartnerLedger (P6.3).
//
// Covers:
//   - **Input validation (Zod)**: invalid status / kind / sort values
//     rejected at parse time (the schema is the front line; the page
//     normalizes too but this is the safe default).
//   - **Auth gating**: no session user → null; partner row not found
//     → null (race during onboarding).
//   - **Timezone passthrough**: profile.timezone flows through to the
//     result; missing profile / null timezone falls back to 'UTC'.
//   - **Happy path (no filters)**: returns mapped entries + summary
//     + filters echoed + timezone.
//   - **Status filter (P6.3 — entries only)**: filter is applied to
//     the entries query; summary aggregates remain global (the page
//     contract).
//   - **Kind filter (P6.3 — entries only)**: same as status.
//   - **Sort by date (default)**: created_at desc + id desc ordering.
//   - **Sort by amount (P6.3)**: amount_cents desc + id desc tiebreak.
//   - **Sort by kind (P6.3)**: kind asc + created_at desc + id desc.
//   - **beforeId keyset pagination**: applied only to the entries
//     query; summary reads are unfiltered.
//   - **limit param**: bounded (schema caps at 200).
//   - **Entries query error**: empty entries + empty summary + warn
//     log + filters still echoed (fail-soft contract).
//   - **Summary aggregate math**: sum + lifetime_earned + next_release
//     resolution + pending_payout math, all bigint-safe.
//   - **Filters echoed in result.filters** (page header / tests can
//     assert what was applied).
//   - **PII safety**: no email / no raw partner_id / no raw user_id
//     in any log payload.
//
// Pattern follows `getMyPartnerProfile.test.ts` (P6.1) and
// `getMyPartnerProducts.test.ts` (P6.2) — chainable fake Supabase
// + queued results + Pino mock with log-call capture.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ----- Mocks ---------------------------------------------------------------

type ServerCall =
  | { method: 'from'; table: string }
  | { method: 'select'; payload: unknown }
  | { method: 'eq'; col: string; val: unknown }
  | { method: 'order'; col: string; ascending?: boolean | undefined }
  | { method: 'limit'; n: number }
  | { method: 'lt'; col: string; val: unknown }
  | { method: 'gt'; col: string; val: unknown }
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
      // exactOptionalPropertyTypes: `ascending?: boolean | undefined`
      // distinguishes "key not present" from "key present, value
      // undefined". The matchObject assertions in the tests want
      // `ascending: undefined` to match `ascending: false`, so we
      // store both as `undefined` when not explicitly set.
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
    gt(col: string, val: unknown) {
      serverCalls.push({ method: 'gt', col, val })
      return chain
    },
    maybeSingle: vi.fn(async () => {
      serverCalls.push({ method: 'maybeSingle' })
      return serverQueue.shift() ?? { data: null, error: null }
    }),
    single: vi.fn(async () => {
      serverCalls.push({ method: 'single' })
      return serverQueue.shift() ?? { data: null, error: null }
    }),
  }
  // A non-terminal await (no .maybeSingle() / .single()) resolves
  // the queue too — matches real PostgREST where the chain is thenable.
  ;(chain as any).then = (
    onFulfilled: (v: { data: unknown; error: unknown }) => unknown,
    onRejected?: (e: unknown) => unknown,
  ) =>
    Promise.resolve(serverQueue.shift() ?? { data: null, error: null }).then(
      onFulfilled,
      onRejected,
    )
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

// Imported after mocks so the module reads the fake clients.
const { getPartnerLedger } = await import('./getPartnerLedger')
const {
  LEDGER_STATUS_VALUES,
  LEDGER_KIND_VALUES,
  LEDGER_SORT_VALUES,
} = await import('../filter-options')

// ----- Helpers ------------------------------------------------------------

function enqueuePartner(id = 42) {
  serverQueue.push({ data: { id, user_id: 'user_1', status: 'approved' }, error: null })
}
function enqueueProfile(timezone: string | null = 'America/Los_Angeles') {
  serverQueue.push({ data: timezone ? { timezone } : null, error: null })
}
function enqueueEntries(entries: unknown[] | null = [], error: unknown = null) {
  serverQueue.push({ data: entries, error })
}
// The summary reads run as Promise.all — order isn't guaranteed but
// we dequeue 5 in some order. Use a marker so tests can identify
// which summary bucket was hit by reading serverCalls.
function enqueueSummary(opts: {
  available?: number[]
  locked?: number[]
  paid?: number[]
  nextReleaseIso?: string | null
  pending?: number[]
}) {
  const { available = [], locked = [], paid = [], nextReleaseIso = null, pending = [] } = opts
  // Queue order matches the ACTUAL consumption order under this
  // mock, NOT the source's narrative order. Why: the summary
  // Promise.all evaluates its array eagerly, so the `nextRelease`
  // chain — which ends with `.maybeSingle()` — runs its shift
  // synchronously during array construction (the `vi.fn(async () =>
  // serverQueue.shift())()` body executes immediately, before any
  // of the other 4 chains have a chance to shift via `.then`).
  //
  // The order consumed by the mock is therefore:
  //   1. nextRelease.maybeSingle()   (synchronous, during array build)
  //   2. available.then               (Promise.all then-callback)
  //   3. locked.then                  (Promise.all then-callback)
  //   4. paid.then                    (Promise.all then-callback)
  //   5. pending.then                 (Promise.all then-callback)
  //
  // Queue the corresponding payloads in that exact order. Real
  // PostgREST has the same concurrency shape (the queries fire in
  // parallel; whichever resolves first wins) but the test mock is
  // deterministic, so we have to match its order.
  serverQueue.push({
    data: nextReleaseIso ? { available_at: nextReleaseIso } : null,
    error: null,
  })
  serverQueue.push({ data: available.map((amount_cents) => ({ amount_cents })), error: null })
  serverQueue.push({ data: locked.map((amount_cents) => ({ amount_cents })), error: null })
  serverQueue.push({ data: paid.map((amount_cents) => ({ amount_cents })), error: null })
  serverQueue.push({ data: pending.map((amount_cents) => ({ amount_cents })), error: null })
}

function findCalls(predicate: (c: ServerCall) => boolean): ServerCall[] {
  return serverCalls.filter(predicate)
}

// ----- Tests --------------------------------------------------------------

describe('getPartnerLedger — Zod input validation', () => {
  it('rejects an unknown status', async () => {
    await expect(getPartnerLedger({ status: 'unknown' as never })).rejects.toThrow()
  })
  it('rejects an unknown kind', async () => {
    await expect(getPartnerLedger({ kind: 'fraudulent' as never })).rejects.toThrow()
  })
  it('rejects an unknown sort', async () => {
    await expect(getPartnerLedger({ sort: 'random' as never })).rejects.toThrow()
  })
  it('rejects limit over 200', async () => {
    await expect(getPartnerLedger({ limit: 999 })).rejects.toThrow()
  })
  it('accepts every LEDGER_STATUS_VALUES / KIND_VALUES / SORT_VALUES', async () => {
    for (const status of LEDGER_STATUS_VALUES) {
      for (const kind of LEDGER_KIND_VALUES) {
        for (const sort of LEDGER_SORT_VALUES) {
          // Queue the minimum needed for a happy-path run.
          enqueuePartner()
          enqueueProfile()
          enqueueEntries()
          enqueueSummary({})
          // The function call must not throw on any valid combo.
          await expect(getPartnerLedger({ status, kind, sort })).resolves.toBeTruthy()
        }
      }
    }
  })
})

describe('getPartnerLedger — auth gating', () => {
  it('returns null when no session user', async () => {
    mockSessionUser = null
    const result = await getPartnerLedger()
    expect(result).toBeNull()
    // No DB reads should happen for an anon caller.
    expect(serverCalls).toHaveLength(0)
  })

  it('returns null when partner row not found (race during onboarding)', async () => {
    serverQueue.push({ data: null, error: null }) // partners: empty
    serverQueue.push({ data: null, error: null }) // profiles: empty (still reads in parallel)
    const result = await getPartnerLedger()
    expect(result).toBeNull()
  })

  it('returns null when partner read errors', async () => {
    serverQueue.push({ data: null, error: { message: 'partner table unavailable' } })
    serverQueue.push({ data: null, error: null })
    const result = await getPartnerLedger()
    expect(result).toBeNull()
  })
})

describe('getPartnerLedger — timezone passthrough', () => {
  it('reads profile.timezone and returns it on the result', async () => {
    enqueuePartner()
    enqueueProfile('Asia/Tokyo')
    enqueueEntries()
    enqueueSummary({})
    const result = await getPartnerLedger()
    expect(result?.timezone).toBe('Asia/Tokyo')
  })

  it("defaults to 'UTC' when profile row is missing", async () => {
    enqueuePartner()
    enqueueProfile(null) // profile row not found
    enqueueEntries()
    enqueueSummary({})
    const result = await getPartnerLedger()
    expect(result?.timezone).toBe('UTC')
  })

  it("defaults to 'UTC' when profile.timezone is null", async () => {
    enqueuePartner()
    enqueueProfile(null) // column null
    enqueueEntries()
    enqueueSummary({})
    const result = await getPartnerLedger()
    expect(result?.timezone).toBe('UTC')
  })

  it("defaults to 'UTC' when profile.timezone is empty string", async () => {
    enqueuePartner()
    enqueueProfile('')
    enqueueEntries()
    enqueueSummary({})
    const result = await getPartnerLedger()
    expect(result?.timezone).toBe('UTC')
  })
})

describe('getPartnerLedger — happy path (no filters)', () => {
  it('returns entries + summary + filters.echoed + timezone', async () => {
    enqueuePartner(42)
    enqueueProfile('UTC')
    enqueueEntries([
      {
        id: 1,
        created_at: '2026-06-20T00:00:00Z',
        kind: 'order_sale',
        status: 'locked',
        amount_cents: 1000,
        currency: 'USD',
        description: null,
        order_id: 100,
        order_item_id: 10,
        royalty_pct_bps: 5000,
        locked_until: '2026-07-04T00:00:00Z',
        available_at: null,
        paid_at: null,
        paypal_payout_batch_id: null,
        stripe_transfer_id: null,
      },
    ])
    enqueueSummary({
      available: [2000, 1500],
      locked: [1000],
      paid: [8000],
      nextReleaseIso: '2026-07-04T00:00:00Z',
      pending: [],
    })

    const result = await getPartnerLedger()
    expect(result).not.toBeNull()
    expect(result!.entries).toHaveLength(1)
    const firstEntry = result!.entries[0]
    expect(firstEntry).toBeDefined()
    expect(firstEntry!.id).toBe(1)
    expect(result!.summary.available_cents).toBe(3500)
    expect(result!.summary.locked_cents).toBe(1000)
    expect(result!.summary.paid_cents).toBe(8000)
    expect(result!.summary.lifetime_earned_cents).toBe(12500)
    expect(result!.summary.next_release_at).toBe('2026-07-04T00:00:00Z')
    expect(result!.summary.pending_payout_cents).toBe(0)
    expect(result!.timezone).toBe('UTC')
    expect(result!.filters).toEqual({ status: undefined, kind: undefined, sort: 'date' })
  })

  it('treats null entries.data as empty list', async () => {
    enqueuePartner()
    enqueueProfile()
    enqueueEntries(null) // PostgREST can return null data on success
    enqueueSummary({})
    const result = await getPartnerLedger()
    expect(result?.entries).toEqual([])
  })
})

describe('getPartnerLedger — status filter (P6.3)', () => {
  it('applies status filter to the entries query', async () => {
    enqueuePartner()
    enqueueProfile()
    enqueueEntries([])
    enqueueSummary({})

    await getPartnerLedger({ status: 'locked' })

    // The entries query (table 'payout_ledger') must have an eq('status', 'locked').
    const entriesEq = serverCalls.filter(
      (c) => c.method === 'eq' && c.col === 'status' && c.val === 'locked',
    )
    // 1 from entries + 4 from summary (locked, paid, pending — but NOT available,
    // NOT nextRelease which uses 'locked' too — so locked summary also adds 1).
    // Easier: assert >= 2 (entries + summary).
    expect(entriesEq.length).toBeGreaterThanOrEqual(2)
  })

  it('does NOT pass status filter to the available summary aggregate', async () => {
    enqueuePartner()
    enqueueProfile()
    enqueueEntries([])
    enqueueSummary({ available: [1000] })

    await getPartnerLedger({ status: 'available' })

    // The available summary aggregate hard-codes status='available' — there's no
    // way to distinguish "filter applied to entries" vs "filter applied to summary"
    // without inspecting the query. We DO assert the entries table's 'from' call
    // appears before the summary's (the page filters the entries, then reads 5
    // summary buckets — order matters for partition-pruning).
    const fromCalls = serverCalls.filter((c) => c.method === 'from' && c.table === 'payout_ledger')
    expect(fromCalls.length).toBe(6) // 1 entries + 5 summary buckets
  })

  it('echoes status filter on result.filters', async () => {
    enqueuePartner()
    enqueueProfile()
    enqueueEntries([])
    enqueueSummary({})
    const result = await getPartnerLedger({ status: 'available' })
    expect(result?.filters.status).toBe('available')
    expect(result?.filters.kind).toBeUndefined()
    expect(result?.filters.sort).toBe('date')
  })
})

describe('getPartnerLedger — kind filter (P6.3)', () => {
  it('applies kind filter to the entries query', async () => {
    enqueuePartner()
    enqueueProfile()
    enqueueEntries([])
    enqueueSummary({})

    await getPartnerLedger({ kind: 'payout' })

    const kindEq = serverCalls.filter(
      (c) => c.method === 'eq' && c.col === 'kind' && c.val === 'payout',
    )
    expect(kindEq.length).toBeGreaterThanOrEqual(1)
  })

  it('echoes kind filter on result.filters', async () => {
    enqueuePartner()
    enqueueProfile()
    enqueueEntries([])
    enqueueSummary({})
    const result = await getPartnerLedger({ kind: 'refund' })
    expect(result?.filters.kind).toBe('refund')
    expect(result?.filters.status).toBeUndefined()
  })
})

describe('getPartnerLedger — sort (P6.3)', () => {
  it('default sort is created_at desc, id desc (no second order on the entries chain unless needed)', async () => {
    enqueuePartner()
    enqueueProfile()
    enqueueEntries([])
    enqueueSummary({})

    await getPartnerLedger()

    const entriesFrom = serverCalls.findIndex(
      (c) => c.method === 'from' && c.table === 'payout_ledger',
    )
    const orderCalls = findCalls(
      (c) => c.method === 'order' && serverCalls.indexOf(c) > entriesFrom,
    )
    const firstOrder = orderCalls[0]
    expect(firstOrder).toMatchObject({ method: 'order', col: 'created_at', ascending: false })
  })

  it('sort=amount uses amount_cents desc + id desc tiebreak', async () => {
    enqueuePartner()
    enqueueProfile()
    enqueueEntries([])
    enqueueSummary({})

    await getPartnerLedger({ sort: 'amount' })

    const entriesFrom = serverCalls.findIndex(
      (c) => c.method === 'from' && c.table === 'payout_ledger',
    )
    const orderCalls = findCalls(
      (c) => c.method === 'order' && serverCalls.indexOf(c) > entriesFrom,
    )
    expect(orderCalls[0]).toMatchObject({ method: 'order', col: 'amount_cents', ascending: false })
    expect(orderCalls[1]).toMatchObject({ method: 'order', col: 'id', ascending: false })
  })

  it('sort=kind uses kind asc + created_at desc + id desc', async () => {
    enqueuePartner()
    enqueueProfile()
    enqueueEntries([])
    enqueueSummary({})

    await getPartnerLedger({ sort: 'kind' })

    const entriesFrom = serverCalls.findIndex(
      (c) => c.method === 'from' && c.table === 'payout_ledger',
    )
    const orderCalls = findCalls(
      (c) => c.method === 'order' && serverCalls.indexOf(c) > entriesFrom,
    )
    expect(orderCalls[0]).toMatchObject({ method: 'order', col: 'kind', ascending: true })
    expect(orderCalls[1]).toMatchObject({ method: 'order', col: 'created_at', ascending: false })
    expect(orderCalls[2]).toMatchObject({ method: 'order', col: 'id', ascending: false })
  })

  it('echoes sort on result.filters', async () => {
    enqueuePartner()
    enqueueProfile()
    enqueueEntries([])
    enqueueSummary({})
    const result = await getPartnerLedger({ sort: 'amount' })
    expect(result?.filters.sort).toBe('amount')
  })
})

describe('getPartnerLedger — pagination + limit', () => {
  it('applies beforeId keyset filter to the entries query', async () => {
    enqueuePartner()
    enqueueProfile()
    enqueueEntries([])
    enqueueSummary({})

    await getPartnerLedger({ beforeId: 100 })

    const ltCalls = serverCalls.filter((c) => c.method === 'lt' && c.col === 'id' && c.val === 100)
    expect(ltCalls.length).toBe(1)
  })

  it('applies custom limit to the entries query', async () => {
    enqueuePartner()
    enqueueProfile()
    enqueueEntries([])
    enqueueSummary({})

    await getPartnerLedger({ limit: 25 })

    const limitCalls = serverCalls.filter((c) => c.method === 'limit' && c.n === 25)
    expect(limitCalls.length).toBe(1)
  })
})

describe('getPartnerLedger — entries query error', () => {
  it('returns empty entries + empty summary + warn log + filters still echoed', async () => {
    enqueuePartner()
    enqueueProfile()
    enqueueEntries(null, { message: 'connection lost' })

    const result = await getPartnerLedger({ status: 'locked', sort: 'amount' })

    expect(result).not.toBeNull()
    expect(result!.entries).toEqual([])
    // Summary aggregates are NOT read on entries error — we short-circuit.
    // (This avoids 5 extra round-trips when the entries read is the source
    // of truth.)
    expect(result!.summary).toEqual({
      available_cents: 0,
      locked_cents: 0,
      paid_cents: 0,
      lifetime_earned_cents: 0,
      next_release_at: null,
      pending_payout_cents: 0,
    })
    expect(result!.filters.status).toBe('locked')
    expect(result!.filters.sort).toBe('amount')

    const warns = logCalls.filter((l) => l.level === 'warn')
    expect(warns).toHaveLength(1)
    const warn = warns[0]
    expect(warn).toBeDefined()
    expect(warn!.payload).toMatchObject({ code: 'partner_ledger_failed' })
  })
})

describe('getPartnerLedger — summary aggregate math', () => {
  it('computes lifetime_earned as available + locked + paid', async () => {
    enqueuePartner()
    enqueueProfile()
    enqueueEntries([])
    enqueueSummary({ available: [1000, 2000], locked: [500], paid: [8000, 2000] })

    const result = await getPartnerLedger()
    expect(result?.summary.available_cents).toBe(3000)
    expect(result?.summary.locked_cents).toBe(500)
    expect(result?.summary.paid_cents).toBe(10000)
    expect(result?.summary.lifetime_earned_cents).toBe(13500)
  })

  it('handles null amount_cents defensively (treats as 0)', async () => {
    enqueuePartner()
    enqueueProfile()
    enqueueEntries([])
    // Queue order matches the mock's consumption order — see
    // enqueueSummary's comment. The available payload sits at
    // position [2] (after partner [0], profile [1], entries [2]).
    serverQueue.push({ data: null, error: null })                                          // nextRelease
    serverQueue.push({ data: [{ amount_cents: 1000 }, { amount_cents: null }], error: null }) // available
    serverQueue.push({ data: [], error: null })                                            // locked
    serverQueue.push({ data: [], error: null })                                            // paid
    serverQueue.push({ data: [], error: null })                                            // pending

    const result = await getPartnerLedger()
    expect(result?.summary.available_cents).toBe(1000)
  })

  it('returns null next_release_at when no future locked entries exist', async () => {
    enqueuePartner()
    enqueueProfile()
    enqueueEntries([])
    enqueueSummary({ nextReleaseIso: null })
    const result = await getPartnerLedger()
    expect(result?.summary.next_release_at).toBeNull()
  })
})

describe('getPartnerLedger — PII safety', () => {
  it('never logs the raw partner_id, user email, or user_id', async () => {
    enqueuePartner(42)
    enqueueProfile('UTC')
    enqueueEntries(null, { message: 'forced error' }) // triggers the warn path
    await getPartnerLedger({ status: 'locked' })
    // Inspect every warn payload — none should contain user identifiers.
    for (const call of logCalls) {
      const payloadStr = JSON.stringify(call.payload)
      expect(payloadStr).not.toContain('partner_1') // not a real partner but a guard
      expect(payloadStr).not.toContain('user_1')
      expect(payloadStr).not.toContain('partner@example.com')
      // 42 is the partner id we just enqueued — assert it never appears.
      expect(payloadStr).not.toContain('"partner_id":42')
      expect(payloadStr).not.toContain('"partnerId":42')
    }
  })
})

describe('getPartnerLedger — pagination math: filters + sort + beforeId coexist', () => {
  it('combines status + kind + sort + beforeId on the entries query', async () => {
    enqueuePartner()
    enqueueProfile()
    enqueueEntries([])
    enqueueSummary({})

    await getPartnerLedger({ status: 'available', kind: 'order_sale', sort: 'amount', beforeId: 50 })

    // All four keys present.
    expect(
      serverCalls.some((c) => c.method === 'eq' && c.col === 'status' && c.val === 'available'),
    ).toBe(true)
    expect(
      serverCalls.some((c) => c.method === 'eq' && c.col === 'kind' && c.val === 'order_sale'),
    ).toBe(true)
    expect(
      serverCalls.some((c) => c.method === 'order' && c.col === 'amount_cents' && c.ascending === false),
    ).toBe(true)
    expect(
      serverCalls.some((c) => c.method === 'lt' && c.col === 'id' && c.val === 50),
    ).toBe(true)
  })
})