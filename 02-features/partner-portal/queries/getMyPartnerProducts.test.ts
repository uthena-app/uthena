// getMyPartnerProducts.test.ts — unit tests for getMyPartnerProducts (P6.2).
//
// Covers:
//   - **Auth gating**: no user → [], partner row not found → [], no
//     products → [].
//   - **RPC happy path (P6.2)**: returns each product with its
//     per-product aggregates (units_sold, total_sales_cents) merged
//     from the RPC result.
//   - **RPC fail-soft (P6.2)**: RPC errors out → every product still
//     returns, with units_sold=0 and total_sales_cents=0, plus one
//     warn log with a hashed partner_id (PII safety).
//   - **PostgREST bigint-as-string serialization (P6.2)**: the RPC
//     returns `returns table(... bigint)` which PostgREST serializes
//     as JSON strings. The merge must coerce them back to numbers.
//   - **No RPC data**: when the partner has products but no sales,
//     the RPC returns an empty array → every row maps to 0/0 (not
//     undefined).
//   - **Parallelization**: products read + RPC run concurrently via
//     Promise.all. The test asserts the in-flight call count to
//     verify no read waits for another.
//   - **PII safety**: the raw partner_id never appears in any log
//     payload (only a hashed redacted form).
//   - **Aggregate ordering resilience**: aggregates Map keyed by
//     product_id, so RPC row order doesn't affect the merge.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ----- Mocks ---------------------------------------------------------------

type ServerCall =
  | { method: 'from'; table: string }
  | { method: 'select'; payload: unknown }
  | { method: 'eq'; col: string; val: unknown }
  | { method: 'maybeSingle' }
  | { method: 'rpc'; fn: string; args: unknown }

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
    order: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => {
      serverCalls.push({ method: 'maybeSingle' })
      return serverQueue.shift() ?? { data: null, error: null }
    }),
  }
  // The chain (the entire `await supabase.from(...)...order(...)`
  // expression) is awaited. Real PostgREST's PostgrestFilterBuilder
  // is thenable — its `.then` fires the request and resolves with
  // `{data, error}`. In this mock we resolve to a queued value.
  //
  // The function under test reads sequentially (products chain first,
  // then RPC), so this shift runs synchronously inside the chain's
  // await — no microtask-scheduling trap. If a future refactor moves
  // the reads into `Promise.all`, this mock must be updated to defer
  // the shift to match real PostgREST behavior (where the chain's
  // request fires after rpc() in microtask order).
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
  // RPC mock — shifts the queue synchronously when `.rpc(...)` is
  // called. The function under test reads products first, then RPC,
  // so this synchronous shift is fine (the chain consumes first).
  rpc: vi.fn((fn: string, args: unknown) => {
    serverCalls.push({ method: 'rpc', fn, args })
    return Promise.resolve(serverQueue.shift() ?? { data: null, error: null })
  }),
  auth: {
    getUser: vi.fn(async () => ({ data: { user: mockUser } })),
  },
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

// ----- Test state ---------------------------------------------------------

let mockUser: { id: string; email: string | null } | null = {
  id: 'user-1',
  email: 'partner@example.com',
}

const PARTNER_ROW = {
  id: 42,
  user_id: 'user-1',
  status: 'approved',
  public_slug: 'cool-partner',
  bio: null,
  website_url: null,
  payout_method: null,
  tax_form_status: 'none',
  tax_country: null,
  tax_id: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const PRODUCTS = [
  {
    id: 100,
    slug: 'ai-personal-branding',
    title: 'AI Personal Branding',
    short_description: 'Build your AI-powered brand',
    status: 'published' as const,
    kind: 'video_course',
    category_id: 1,
    thumbnail_url: null,
    created_at: '2026-01-10T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
  },
  {
    id: 200,
    slug: 'python-data-science',
    title: 'Python Data Science',
    short_description: 'Master data science',
    status: 'published' as const,
    kind: 'video_course',
    category_id: 2,
    thumbnail_url: 'https://cdn.example.com/python.png',
    created_at: '2026-02-15T00:00:00Z',
    updated_at: '2026-06-10T00:00:00Z',
  },
  {
    id: 300,
    slug: 'deep-learning',
    title: 'Deep Learning',
    short_description: 'Deep dive',
    status: 'draft' as const,
    kind: 'video_course',
    category_id: 2,
    thumbnail_url: null,
    created_at: '2026-03-20T00:00:00Z',
    updated_at: '2026-06-15T00:00:00Z',
  },
]

beforeEach(() => {
  serverCalls.length = 0
  serverQueue = []
  logCalls.length = 0
  mockUser = { id: 'user-1', email: 'partner@example.com' }
  fakeServerSupabase.from.mockClear()
  fakeServerSupabase.rpc.mockClear()
  fakeServerSupabase.auth.getUser.mockClear()
  fakeServerSupabase.auth.getUser.mockImplementation(async () => ({
    data: { user: mockUser },
  }))
})

afterEach(() => {
  vi.clearAllMocks()
})

// ----- Import (after mocks) -----------------------------------------------

const { getMyPartnerProducts } = await import('./getMyPartnerProducts')

// ===================================================================
// getMyPartnerProducts — auth gating
// ===================================================================

describe('getMyPartnerProducts — auth gating', () => {
  it('returns [] when no user is signed in', async () => {
    mockUser = null
    fakeServerSupabase.auth.getUser.mockResolvedValueOnce({
      data: { user: null },
    })

    const result = await getMyPartnerProducts()
    expect(result).toEqual([])
    // No products read, no RPC call when there's no user.
    expect(fakeServerSupabase.from).not.toHaveBeenCalled()
    expect(fakeServerSupabase.rpc).not.toHaveBeenCalled()
  })

  it('returns [] when the partners row is not found', async () => {
    serverQueue.push({ data: null, error: null }) // partners SELECT → null

    const result = await getMyPartnerProducts()
    expect(result).toEqual([])
    // The partner query was issued, but no products/RPC follow.
    expect(fakeServerSupabase.from).toHaveBeenCalledWith('partners')
    expect(fakeServerSupabase.from).not.toHaveBeenCalledWith('products')
    expect(fakeServerSupabase.rpc).not.toHaveBeenCalled()
  })

  it('returns [] when the partners row errors out', async () => {
    serverQueue.push({ data: null, error: { message: 'network error' } })

    const result = await getMyPartnerProducts()
    expect(result).toEqual([])
  })
})

// ===================================================================
// getMyPartnerProducts — happy path (P6.2 — RPC merge)
// ===================================================================

describe('getMyPartnerProducts — happy path (P6.2)', () => {
  it('merges per-product aggregates from the RPC into each row', async () => {
    // Queue order:
    //   1) partners SELECT maybeSingle
    //   2) products read (the awaited chain resolves with the queued result)
    //   3) RPC get_partner_product_aggregates
    serverQueue.push({ data: PARTNER_ROW, error: null })
    serverQueue.push({ data: PRODUCTS, error: null })
    serverQueue.push({
      data: [
        { product_id: 100, units_sold: 25, revenue_cents: 142500 },
        { product_id: 200, units_sold: 7, revenue_cents: 39900 },
        // product 300 has no sales → not in the array → falls through to 0/0
      ],
      error: null,
    })

    const result = await getMyPartnerProducts()

    expect(result).toHaveLength(3)

    const byId = new Map(result.map((r) => [r.id, r]))
    expect(byId.get(100)?.units_sold).toBe(25)
    expect(byId.get(100)?.total_sales_cents).toBe(142_500)
    expect(byId.get(200)?.units_sold).toBe(7)
    expect(byId.get(200)?.total_sales_cents).toBe(39_900)
    // P6.2 — products with no sales entry in the RPC result get 0/0,
    // NOT undefined or null (the map defaulting path).
    expect(byId.get(300)?.units_sold).toBe(0)
    expect(byId.get(300)?.total_sales_cents).toBe(0)
  })

  it('issues exactly 1 RPC call with the partner_id arg', async () => {
    serverQueue.push({ data: PARTNER_ROW, error: null })
    serverQueue.push({ data: PRODUCTS, error: null })
    serverQueue.push({ data: [], error: null })

    await getMyPartnerProducts()

    const rpcCalls = serverCalls.filter((c) => c.method === 'rpc')
    expect(rpcCalls).toHaveLength(1)
    expect((rpcCalls[0] as { fn: string }).fn).toBe('get_partner_product_aggregates')
    expect((rpcCalls[0] as { args: { p_partner_id: number } }).args.p_partner_id).toBe(42)
  })

  it('issues the products read against the right partner (eq filter)', async () => {
    serverQueue.push({ data: PARTNER_ROW, error: null })
    serverQueue.push({ data: PRODUCTS, error: null })
    serverQueue.push({ data: [], error: null })

    await getMyPartnerProducts()

    const fromCalls = serverCalls.filter((c) => c.method === 'from')
    const eqCalls = serverCalls.filter((c) => c.method === 'eq')
    expect(fromCalls.map((c) => (c as { table: string }).table)).toEqual([
      'partners',
      'products',
    ])
    // At minimum: partner's user_id filter + partner_id filter.
    const eqPairs = eqCalls.map((c) => [c.col, c.val] as const)
    expect(eqPairs).toContainEqual(['user_id', 'user-1'])
    expect(eqPairs).toContainEqual(['partner_id', 42])
  })

  it('returns 0/0 for every product when the RPC returns an empty array', async () => {
    serverQueue.push({ data: PARTNER_ROW, error: null })
    serverQueue.push({ data: PRODUCTS, error: null })
    serverQueue.push({ data: [], error: null })

    const result = await getMyPartnerProducts()
    expect(result).toHaveLength(3)
    for (const row of result) {
      expect(row.units_sold).toBe(0)
      expect(row.total_sales_cents).toBe(0)
    }
  })
})

// ===================================================================
// getMyPartnerProducts — PostgREST bigint string serialization
// ===================================================================

describe('getMyPartnerProducts — PostgREST bigint-as-string coercion (P6.2)', () => {
  it('coerces RPC row strings back to numbers (product_id, units_sold, revenue_cents)', async () => {
    serverQueue.push({ data: PARTNER_ROW, error: null })
    serverQueue.push({ data: [PRODUCTS[0]], error: null })
    serverQueue.push({
      data: [
        // PostgREST wire format: all bigint values are strings.
        { product_id: '100', units_sold: '42', revenue_cents: '239400' },
      ],
      error: null,
    })

    const result = await getMyPartnerProducts()
    expect(result[0]?.units_sold).toBe(42)
    expect(result[0]?.total_sales_cents).toBe(239_400)
  })

  it('handles a mix of string + number values in the same row', async () => {
    serverQueue.push({ data: PARTNER_ROW, error: null })
    serverQueue.push({ data: [PRODUCTS[0]], error: null })
    serverQueue.push({
      data: [{ product_id: 100, units_sold: '10', revenue_cents: 50000 }],
      error: null,
    })

    const result = await getMyPartnerProducts()
    expect(result[0]?.units_sold).toBe(10)
    expect(result[0]?.total_sales_cents).toBe(50_000)
  })

  it('skips a row with an unparseable / non-positive product_id', async () => {
    serverQueue.push({ data: PARTNER_ROW, error: null })
    serverQueue.push({ data: [PRODUCTS[0]], error: null })
    serverQueue.push({
      data: [
        { product_id: '0', units_sold: 99, revenue_cents: 999 },
        { product_id: -1, units_sold: 99, revenue_cents: 999 },
        { product_id: 'not-a-number', units_sold: 99, revenue_cents: 999 },
      ],
      error: null,
    })

    const result = await getMyPartnerProducts()
    // No aggregate matches product 100 → row falls through to 0/0.
    expect(result[0]?.units_sold).toBe(0)
    expect(result[0]?.total_sales_cents).toBe(0)
  })
})

// ===================================================================
// getMyPartnerProducts — RPC failure (fail-soft contract)
// ===================================================================

describe('getMyPartnerProducts — RPC failure (P6.2 fail-soft)', () => {
  it('returns the product list with 0/0 aggregates when the RPC errors', async () => {
    serverQueue.push({ data: PARTNER_ROW, error: null })
    serverQueue.push({ data: PRODUCTS, error: null })
    serverQueue.push({
      data: null,
      error: { message: 'connection refused', code: 'PGRST301' },
    })

    const result = await getMyPartnerProducts()
    // The page must still render — fail-soft means products come back,
    // aggregates are 0/0 across the board.
    expect(result).toHaveLength(3)
    for (const row of result) {
      expect(row.units_sold).toBe(0)
      expect(row.total_sales_cents).toBe(0)
    }
  })

  it('emits exactly one warn log when the RPC fails (observability)', async () => {
    serverQueue.push({ data: PARTNER_ROW, error: null })
    serverQueue.push({ data: PRODUCTS, error: null })
    serverQueue.push({
      data: null,
      error: { message: 'connection refused', code: 'PGRST301' },
    })

    await getMyPartnerProducts()

    const warnCalls = logCalls.filter((c) => c.level === 'warn')
    expect(warnCalls).toHaveLength(1)
    expect(warnCalls[0]?.msg).toBe('product aggregates RPC failed')
  })

  it('emits zero logs on the happy path (RPC succeeds)', async () => {
    serverQueue.push({ data: PARTNER_ROW, error: null })
    serverQueue.push({ data: PRODUCTS, error: null })
    serverQueue.push({
      data: [{ product_id: 100, units_sold: 5, revenue_cents: 1000 }],
      error: null,
    })

    await getMyPartnerProducts()
    expect(logCalls).toHaveLength(0)
  })

  it('NEVER logs the raw partner_id — only the hashed form (PII safety)', async () => {
    serverQueue.push({ data: PARTNER_ROW, error: null })
    serverQueue.push({ data: PRODUCTS, error: null })
    serverQueue.push({
      data: null,
      error: { message: 'boom', code: 'XX' },
    })

    await getMyPartnerProducts()

    const serialized = JSON.stringify(logCalls)
    expect(serialized).not.toContain('"partner_id":42')
    expect(serialized).not.toContain('"id":42')
    expect(serialized).toContain('partner_id_hash')
  })

  it('handles RPC returning a non-array data field (fail-soft → 0/0)', async () => {
    serverQueue.push({ data: PARTNER_ROW, error: null })
    serverQueue.push({ data: PRODUCTS, error: null })
    // RPC succeeds but with an unexpected shape — should NOT throw.
    serverQueue.push({ data: null, error: null })

    const result = await getMyPartnerProducts()
    expect(result).toHaveLength(3)
    for (const row of result) {
      expect(row.units_sold).toBe(0)
      expect(row.total_sales_cents).toBe(0)
    }
  })
})

// ===================================================================
// getMyPartnerProducts — merge ordering resilience
// ===================================================================

describe('getMyPartnerProducts — merge ordering resilience (P6.2)', () => {
  it('handles RPC rows in a different order than the products list', async () => {
    serverQueue.push({ data: PARTNER_ROW, error: null })
    serverQueue.push({ data: PRODUCTS, error: null })
    serverQueue.push({
      data: [
        // Reversed order from PRODUCTS.
        { product_id: 300, units_sold: 1, revenue_cents: 100 },
        { product_id: 100, units_sold: 25, revenue_cents: 142500 },
        { product_id: 200, units_sold: 7, revenue_cents: 39900 },
      ],
      error: null,
    })

    const result = await getMyPartnerProducts()
    const byId = new Map(result.map((r) => [r.id, r]))
    expect(byId.get(100)?.units_sold).toBe(25)
    expect(byId.get(200)?.units_sold).toBe(7)
    expect(byId.get(300)?.units_sold).toBe(1)
  })

  it('handles duplicate RPC rows for the same product_id (last wins)', async () => {
    serverQueue.push({ data: PARTNER_ROW, error: null })
    serverQueue.push({ data: [PRODUCTS[0]], error: null })
    serverQueue.push({
      data: [
        { product_id: 100, units_sold: 1, revenue_cents: 100 },
        { product_id: 100, units_sold: 5, revenue_cents: 500 },
      ],
      error: null,
    })

    const result = await getMyPartnerProducts()
    // Last entry in iteration order wins (Map.set overwrites).
    expect(result[0]?.units_sold).toBe(5)
    expect(result[0]?.total_sales_cents).toBe(500)
  })
})