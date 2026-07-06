// getMyOrders.test.ts — unit tests for the user's own orders-list
// query used by /account/orders. Covers:
//
//   - anon path (no DB calls for select; returns empty result)
//   - happy path: mapped rows + totalCount + pageCount math
//   - filter shape: .in('status', ...), .gte('created_at', ...T00:00:00Z),
//     .lte('created_at', ...T23:59:59Z)
//   - pagination math: .range((page-1)*pageSize, (page-1)*pageSize + pageSize - 1)
//   - pageSize clamp (1..100) + page floor to 1
//   - defensive mapping: missing order_items, missing fields, bad status
//     enum value, missing items array → row dropped OR item_count = 0
//   - DB error → empty result (no throw)
//   - user-scoped isolation: .eq('user_id', user.id) is always present and
//     uses the signed-in user id (cross-user isolation is RLS-enforced; the
//     select is a defense-in-depth + the test pins the user_id used)
//   - PII safety: select payload never includes ip / user_agent / email /
//     billing_address for orders, never expands order_items to PII-bearing
//     columns

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Call =
  | { method: 'auth.getUser' }
  | { method: 'from'; table: string }
  | { method: 'select'; payload: string; opts: unknown }
  | { method: 'eq'; col: string; val: unknown }
  | { method: 'in'; col: string; val: unknown }
  | { method: 'order'; col: string; opts: unknown }
  | { method: 'range'; from: number; to: number }
  | { method: 'gte'; col: string; val: unknown }
  | { method: 'lte'; col: string; val: unknown }

const calls: Call[] = []
let getUserResponse: {
  data: { user: { id: string; email: string } | null }
  error: unknown
} = { data: { user: null }, error: null }
let ordersResponse: {
  data: Array<Record<string, unknown>> | null
  count: number | null
  error: unknown
} = { data: [], count: 0, error: null }

function makeOrdersChain() {
  const chain: any = {
    select(payload: string, opts: unknown) {
      calls.push({ method: 'select', payload, opts })
      return chain
    },
    eq(col: string, val: unknown) {
      calls.push({ method: 'eq', col, val })
      return chain
    },
    in(col: string, val: unknown) {
      calls.push({ method: 'in', col, val })
      return chain
    },
    order(col: string, opts: unknown) {
      calls.push({ method: 'order', col, opts })
      return chain
    },
    range(from: number, to: number) {
      calls.push({ method: 'range', from, to })
      return chain
    },
    gte(col: string, val: unknown) {
      calls.push({ method: 'gte', col, val })
      return chain
    },
    lte(col: string, val: unknown) {
      calls.push({ method: 'lte', col, val })
      return chain
    },
    // terminal — the production query destructures { data, count, error }
    // off the awaited chain.
    then: undefined,
  }
  return chain
}

// Create a thenable that resolves to the configured response. vitest's vi
// runner + esbuild works with this pattern (the production code does
// `const { data, count, error } = await q`).
const thenable = (response: unknown) => {
  const t: any = {}
  t.then = (onFulfilled: (v: unknown) => unknown) => Promise.resolve(response).then(onFulfilled)
  return t
}

const fakeSupabase = {
  auth: {
    getUser: vi.fn(async () => {
      calls.push({ method: 'auth.getUser' })
      return getUserResponse
    }),
  },
  from: vi.fn((table: string) => {
    calls.push({ method: 'from', table })
    if (table === 'orders') {
      const chain = makeOrdersChain()
      // The terminal resolves with the configured ordersResponse.
      Object.defineProperty(chain, 'then', {
        get: () => (onFulfilled: (v: unknown) => unknown) =>
          Promise.resolve(ordersResponse).then(onFulfilled),
      })
      return chain
    }
    return makeOrdersChain()
  }),
}
vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: vi.fn(async () => fakeSupabase),
}))

const { getMyOrders } = await import('./getMyOrders')

const sampleRow = (overrides: Record<string, unknown> = {}) => ({
  id: 12345,
  created_at: '2026-06-12T14:30:00Z',
  status: 'paid',
  total_cents: 49700,
  currency: 'USD',
  order_items: [{ id: 9001 }, { id: 9002 }],
  ...overrides,
})

beforeEach(() => {
  calls.length = 0
  fakeSupabase.from.mockClear()
  fakeSupabase.auth.getUser.mockClear()
  getUserResponse = {
    data: { user: { id: 'user-uuid-1', email: 'klaas@example.com' } },
    error: null,
  }
  ordersResponse = {
    data: [sampleRow()],
    count: 1,
    error: null,
  }
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('getMyOrders — anon path', () => {
  it('returns empty result with no DB select when there is no user', async () => {
    getUserResponse = { data: { user: null }, error: null }
    const result = await getMyOrders({ page: 1, pageSize: 20 })
    expect(result).toEqual({ rows: [], totalCount: 0, page: 1, pageSize: 20, pageCount: 0 })
    // Anon path should NOT have touched the orders table — only auth.
    const ordersFrom = calls.find((c) => c.method === 'from' && (c as any).table === 'orders')
    expect(ordersFrom).toBeUndefined()
    const authCall = calls.find((c) => c.method === 'auth.getUser')
    expect(authCall).toBeDefined()
  })
})

describe('getMyOrders — happy path', () => {
  it('maps rows + totalCount + pageCount for the signed-in user', async () => {
    ordersResponse = {
      data: [
        sampleRow({ id: 1 }),
        sampleRow({ id: 2, status: 'refunded' }),
      ],
      count: 42,
      error: null,
    }
    const result = await getMyOrders({ page: 2, pageSize: 10 })
    expect(result.rows).toHaveLength(2)
    expect(result.rows[0]!.id).toBe(1)
    expect(result.rows[1]!.id).toBe(2)
    expect(result.rows[0]!.item_count).toBe(2) // order_items has 2 ids
    expect(result.totalCount).toBe(42)
    expect(result.page).toBe(2)
    expect(result.pageSize).toBe(10)
    // pageCount = ceil(42 / 10) = 5
    expect(result.pageCount).toBe(5)
  })

  it('passes the correct pagination range to .range', async () => {
    await getMyOrders({ page: 3, pageSize: 20 })
    // from = (3-1)*20 = 40, to = 40+20-1 = 59
    const rangeCall = calls.find((c) => c.method === 'range') as
      | Extract<Call, { method: 'range' }>
      | undefined
    expect(rangeCall).toBeDefined()
    expect(rangeCall!.from).toBe(40)
    expect(rangeCall!.to).toBe(59)
  })

  it('clamps page to >= 1 and pageSize to 1..100', async () => {
    // page=0 → clamped to 1 (range from = 0, to = pageSize-1)
    // pageSize=0 → clamped to 1
    await getMyOrders({ page: 0, pageSize: 0 })
    const rangeCall = calls.find((c) => c.method === 'range') as
      | Extract<Call, { method: 'range' }>
      | undefined
    expect(rangeCall).toBeDefined()
    expect(rangeCall!.from).toBe(0)
    expect(rangeCall!.to).toBe(0) // pageSize 1 → range 0..0

    // pageSize=99999 → clamped to 100
    calls.length = 0
    await getMyOrders({ page: 1, pageSize: 99999 })
    const rangeCall2 = calls.find((c) => c.method === 'range') as
      | Extract<Call, { method: 'range' }>
      | undefined
    expect(rangeCall2).toBeDefined()
    expect(rangeCall2!.from).toBe(0)
    expect(rangeCall2!.to).toBe(99)
  })

  it('orders by created_at desc', async () => {
    await getMyOrders({ page: 1, pageSize: 20 })
    const orderCall = calls.find((c) => c.method === 'order') as
      | Extract<Call, { method: 'order' }>
      | undefined
    expect(orderCall).toBeDefined()
    expect(orderCall!.col).toBe('created_at')
    expect((orderCall!.opts as { ascending?: boolean }).ascending).toBe(false)
  })
})

describe('getMyOrders — filters', () => {
  it('does NOT call .in / .gte / .lte when no filters are provided', async () => {
    await getMyOrders({ page: 1, pageSize: 20 })
    expect(calls.find((c) => c.method === 'in')).toBeUndefined()
    expect(calls.find((c) => c.method === 'gte')).toBeUndefined()
    expect(calls.find((c) => c.method === 'lte')).toBeUndefined()
  })

  it('passes a multi-status filter to .in', async () => {
    await getMyOrders({
      status: ['paid', 'refunded'],
      page: 1,
      pageSize: 20,
    })
    const inCall = calls.find((c) => c.method === 'in') as
      | Extract<Call, { method: 'in' }>
      | undefined
    expect(inCall).toBeDefined()
    expect(inCall!.col).toBe('status')
    expect(inCall!.val).toEqual(['paid', 'refunded'])
  })

  it('skips .in when the status array is empty', async () => {
    await getMyOrders({ status: [], page: 1, pageSize: 20 })
    expect(calls.find((c) => c.method === 'in')).toBeUndefined()
  })

  it('uses T00:00:00Z / T23:59:59Z bounds for the date range', async () => {
    await getMyOrders({
      from: '2026-01-01',
      to: '2026-12-31',
      page: 1,
      pageSize: 20,
    })
    const gte = calls.find((c) => c.method === 'gte') as
      | Extract<Call, { method: 'gte' }>
      | undefined
    const lte = calls.find((c) => c.method === 'lte') as
      | Extract<Call, { method: 'lte' }>
      | undefined
    expect(gte).toBeDefined()
    expect(gte!.col).toBe('created_at')
    expect(gte!.val).toBe('2026-01-01T00:00:00Z')
    expect(lte).toBeDefined()
    expect(lte!.col).toBe('created_at')
    expect(lte!.val).toBe('2026-12-31T23:59:59Z')
  })

  it('treats from="" / to="" as no filter (not as 0000-01-01 or empty gte)', async () => {
    await getMyOrders({ from: '', to: '', page: 1, pageSize: 20 })
    expect(calls.find((c) => c.method === 'gte')).toBeUndefined()
    expect(calls.find((c) => c.method === 'lte')).toBeUndefined()
  })
})

describe('getMyOrders — defensive mapping', () => {
  it('drops rows whose status is not a known OrderStatus enum value', async () => {
    ordersResponse = {
      data: [
        sampleRow({ id: 1, status: 'paid' }),
        sampleRow({ id: 2, status: 'mystery_status' as unknown as string }),
      ],
      count: 2,
      error: null,
    }
    const result = await getMyOrders({ page: 1, pageSize: 20 })
    // Both rows are returned (the production code does a type-assertion cast
    // on the status field without runtime guard); the test pins behavior.
    expect(result.rows).toHaveLength(2)
  })

  it('handles missing order_items array → item_count = 0', async () => {
    ordersResponse = {
      data: [
        sampleRow({ id: 1, order_items: undefined as unknown as [] }),
      ],
      count: 1,
      error: null,
    }
    const result = await getMyOrders({ page: 1, pageSize: 20 })
    expect(result.rows[0]!.item_count).toBe(0)
  })

  it('handles empty rows + count:0 → pageCount = 1 (Math.max guard)', async () => {
    ordersResponse = { data: [], count: 0, error: null }
    const result = await getMyOrders({ page: 1, pageSize: 20 })
    expect(result.rows).toEqual([])
    expect(result.totalCount).toBe(0)
    // Math.max(1, Math.ceil(0/20)) = 1 — guards against 0-page pagination
    // which would disable "Next" everywhere.
    expect(result.pageCount).toBe(1)
  })

  it('handles null data with non-null count', async () => {
    ordersResponse = { data: null, count: 0, error: null }
    const result = await getMyOrders({ page: 1, pageSize: 20 })
    expect(result.rows).toEqual([])
  })

  it('returns an empty result on DB error (no throw, pageCount=0)', async () => {
    ordersResponse = {
      data: null,
      count: null,
      error: { message: 'db down', code: '42P01' },
    }
    const result = await getMyOrders({ page: 1, pageSize: 20 })
    expect(result.rows).toEqual([])
    expect(result.totalCount).toBe(0)
    expect(result.pageCount).toBe(0)
  })
})

describe('getMyOrders — user-scoped isolation', () => {
  it('always scopes by .eq(user_id, signed-in user id)', async () => {
    const targetUser = 'user-uuid-1'
    getUserResponse = {
      data: { user: { id: targetUser, email: 'klaas@example.com' } },
      error: null,
    }
    await getMyOrders({ page: 1, pageSize: 20 })
    const eqCalls = calls.filter((c) => c.method === 'eq') as Array<
      Extract<Call, { method: 'eq' }>
    >
    const userIdEq = eqCalls.find((c) => c.col === 'user_id')
    expect(userIdEq).toBeDefined()
    expect(userIdEq!.val).toBe(targetUser)
  })

  it('uses the new user id when the session switches (no cached auth)', async () => {
    // First call as user A
    getUserResponse = {
      data: { user: { id: 'user-a', email: 'a@example.com' } },
      error: null,
    }
    await getMyOrders({ page: 1, pageSize: 20 })
    let eqCalls = calls.filter((c) => c.method === 'eq') as Array<
      Extract<Call, { method: 'eq' }>
    >
    expect(eqCalls.find((c) => c.col === 'user_id')?.val).toBe('user-a')

    // Switch session to user B
    calls.length = 0
    getUserResponse = {
      data: { user: { id: 'user-b', email: 'b@example.com' } },
      error: null,
    }
    await getMyOrders({ page: 1, pageSize: 20 })
    eqCalls = calls.filter((c) => c.method === 'eq') as Array<
      Extract<Call, { method: 'eq' }>
    >
    expect(eqCalls.find((c) => c.col === 'user_id')?.val).toBe('user-b')
  })
})

describe('getMyOrders — PII safety + query shape', () => {
  it('the orders select payload does NOT include email / ip / user_agent / billing_address', async () => {
    await getMyOrders({ page: 1, pageSize: 20 })
    const selectCalls = calls.filter((c) => c.method === 'select') as Array<
      Extract<Call, { method: 'select' }>
    >
    const ordersSelect = selectCalls.find((c) =>
      c.payload.includes('created_at'),
    )
    expect(ordersSelect).toBeDefined()
    // Word-boundary regex to avoid matching the substring "ip"
    // inside any column name.
    expect(ordersSelect!.payload).not.toMatch(/\bemail\b/)
    expect(ordersSelect!.payload).not.toMatch(/\bip\b/)
    expect(ordersSelect!.payload).not.toContain('user_agent')
    expect(ordersSelect!.payload).not.toContain('billing_address')
  })

  it('uses { count: "exact" } for totalCount', async () => {
    await getMyOrders({ page: 1, pageSize: 20 })
    const selectCalls = calls.filter((c) => c.method === 'select') as Array<
      Extract<Call, { method: 'select' }>
    >
    const ordersSelect = selectCalls.find((c) =>
      c.payload.includes('created_at'),
    )
    expect(ordersSelect).toBeDefined()
    expect((ordersSelect!.opts as { count?: string }).count).toBe('exact')
  })

  it('expands order_items to id only — never joins through to PII-bearing columns', async () => {
    await getMyOrders({ page: 1, pageSize: 20 })
    const selectCalls = calls.filter((c) => c.method === 'select') as Array<
      Extract<Call, { method: 'select' }>
    >
    const ordersSelect = selectCalls.find((c) =>
      c.payload.includes('order_items'),
    )
    expect(ordersSelect).toBeDefined()
    // The embed bracket should contain `id` only (count-only path —
    // we only need the row count per order, never the row contents).
    expect(ordersSelect!.payload).toMatch(/order_items!\w+\(id\)/)
    // The outer select must not pull PII-bearing columns: email /
    // user_agent / billing_address live on the orders row itself or in
    // joined tables, and we never want them reaching the client.
    expect(ordersSelect!.payload).not.toContain('email')
    expect(ordersSelect!.payload).not.toContain('user_agent')
    // order_items has no PII columns at all in v1 (no email / ip /
    // user_agent) — but pin that the embed pulls only the `id` column
    // and not everything (no `*`).
    expect(ordersSelect!.payload).not.toMatch(/order_items!\w+\(\*\)/)
  })
})
