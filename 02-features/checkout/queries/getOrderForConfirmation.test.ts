// getOrderForConfirmation.test.ts — unit tests for the
// getOrderForConfirmation query used by the checkout success page.
//
// Covers:
//   - Anon user → returns null without touching the DB (defense in
//     depth: the page also redirects; this is the query's contract).
//   - Happy path → returns the mapped OrderForConfirmation shape
//     (id, status, money fields, currency, email, paid_at, created_at,
//     items[].{id, product_id, license, quantity, unit_price_cents,
//     line_total_cents, title, thumbnail_url, slug}, grant_count).
//   - Owner mismatch (RLS bypass: the row is returned but the user_id
//     doesn't match the session) → returns null + logs warn.
//   - DB error → returns null + logs warn.
//   - Empty result (no row for the id) → returns null.
//   - Defensive item mapping: missing product join → title/slug become
//     empty strings, thumbnail_url becomes null (no throw).
//   - Defensive item mapping: missing items array → empty array.
//   - Defensive grant mapping: missing grants array → grant_count = 0.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ----- Mock @foundations/data/supabase -------------------------------
type Call =
  | { method: 'select'; payload: unknown }
  | { method: 'eq'; col: string; val: unknown }
  | { method: 'maybeSingle' }

const serverCalls: Call[] = []
let serverQueue: Array<{ data: unknown; error: unknown }> = []

function makeChain() {
  const chain: any = {
    select(payload: unknown) {
      serverCalls.push({ method: 'select', payload })
      return chain
    },
    eq(col: string, val: unknown) {
      serverCalls.push({ method: 'eq', col, val })
      return chain
    },
    maybeSingle: vi.fn(async () => {
      serverCalls.push({ method: 'maybeSingle' })
      const next = serverQueue.shift() ?? { data: null, error: null }
      return next
    }),
  }
  return chain
}

const fakeServerSupabase = { from: vi.fn(() => makeChain()) }

vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: vi.fn(async () => fakeServerSupabase),
}))

// ----- Mock auth guard ----------------------------------------------
let mockUser: { id: string; email: string | null } | null = null
vi.mock('@foundations/auth/guards', () => ({
  getSessionUser: vi.fn(async () => mockUser),
}))

// ----- Mock logger --------------------------------------------------
const mockWarn = vi.fn()
vi.mock('@foundations/log/pino', () => ({
  loggerFor: () => ({
    info: vi.fn(),
    warn: (...args: unknown[]) => mockWarn(...args),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

// ----- Import after mocks ------------------------------------------
const { getOrderForConfirmation } = await import('./getOrderForConfirmation')

beforeEach(() => {
  serverCalls.length = 0
  serverQueue = []
  mockUser = { id: 'user-1', email: 'user@example.com' }
  fakeServerSupabase.from.mockClear()
  mockWarn.mockClear()
})

afterEach(() => {
  vi.clearAllMocks()
})

// ===================================================================
// Auth gating
// ===================================================================

describe('getOrderForConfirmation — auth gating', () => {
  it('returns null when no user is signed in (no DB call)', async () => {
    mockUser = null
    const res = await getOrderForConfirmation(42)
    expect(res).toBeNull()
    expect(fakeServerSupabase.from).not.toHaveBeenCalled()
  })
})

// ===================================================================
// Happy path
// ===================================================================

describe('getOrderForConfirmation — happy path', () => {
  it('returns the full OrderForConfirmation shape on a clean row', async () => {
    serverQueue.push({
      data: {
        id: 42,
        user_id: 'user-1',
        status: 'paid',
        subtotal_cents: 5000,
        discount_cents: 0,
        tax_cents: 0,
        total_cents: 5000,
        currency: 'USD',
        email: 'user@example.com',
        paid_at: '2026-06-26T10:00:00Z',
        created_at: '2026-06-26T09:59:00Z',
        items: [
          {
            id: 1,
            product_id: 100,
            license: 'plr',
            quantity: 1,
            unit_price_cents: 5000,
            line_total_cents: 5000,
            product: { slug: 'ai-branding', title: 'AI Personal Branding', thumbnail_url: 'https://cdn.example.com/ai-branding.jpg' },
          },
        ],
        grants: [{ id: 1 }, { id: 2 }],
      },
      error: null,
    })

    const res = await getOrderForConfirmation(42)
    expect(res).not.toBeNull()
    expect(res).toMatchObject({
      id: 42,
      status: 'paid',
      subtotal_cents: 5000,
      discount_cents: 0,
      tax_cents: 0,
      total_cents: 5000,
      currency: 'USD',
      email: 'user@example.com',
      paid_at: '2026-06-26T10:00:00Z',
      created_at: '2026-06-26T09:59:00Z',
      grant_count: 2,
    })
    expect(res?.items).toEqual([
      {
        id: 1,
        product_id: 100,
        license: 'plr',
        quantity: 1,
        unit_price_cents: 5000,
        line_total_cents: 5000,
        title: 'AI Personal Branding',
        thumbnail_url: 'https://cdn.example.com/ai-branding.jpg',
        slug: 'ai-branding',
      },
    ])
  })

  it('asserts the query shape: orders select with items+grants join, eq by id', async () => {
    serverQueue.push({
      data: {
        id: 42,
        user_id: 'user-1',
        status: 'paid',
        subtotal_cents: 5000,
        discount_cents: 0,
        tax_cents: 0,
        total_cents: 5000,
        currency: 'USD',
        email: 'user@example.com',
        paid_at: null,
        created_at: '2026-06-26T09:59:00Z',
        items: [],
        grants: [],
      },
      error: null,
    })

    await getOrderForConfirmation(42)

    expect(fakeServerSupabase.from).toHaveBeenCalledWith('orders')
    const selectCall = serverCalls.find((c) => c.method === 'select')
    expect(selectCall).toBeDefined()
    if (selectCall?.method === 'select') {
      const payload = selectCall.payload as string
      expect(payload).toContain('order_items')
      expect(payload).toContain('library_grants')
      expect(payload).toContain('subtotal_cents')
    }
    const eqCall = serverCalls.find((c) => c.method === 'eq')
    expect(eqCall).toEqual({ method: 'eq', col: 'id', val: 42 })
  })
})

// ===================================================================
// Defense in depth: owner check on top of RLS
// ===================================================================

describe('getOrderForConfirmation — defense in depth', () => {
  it('returns null + logs warn when user_id does not match the session', async () => {
    // RLS bypass scenario: a row was somehow returned whose user_id
    // doesn't match the signed-in user. The query must still refuse
    // to surface it.
    serverQueue.push({
      data: {
        id: 42,
        user_id: 'someone-else',
        status: 'paid',
        subtotal_cents: 5000,
        discount_cents: 0,
        tax_cents: 0,
        total_cents: 5000,
        currency: 'USD',
        email: 'user@example.com',
        paid_at: null,
        created_at: '2026-06-26T09:59:00Z',
        items: [],
        grants: [],
      },
      error: null,
    })

    const res = await getOrderForConfirmation(42)
    expect(res).toBeNull()
    expect(mockWarn).toHaveBeenCalled()
    const warnArg = mockWarn.mock.calls[0]?.[0] as { code?: string }
    expect(warnArg?.code).toBe('order_owner_mismatch')
  })
})

// ===================================================================
// Error + empty paths
// ===================================================================

describe('getOrderForConfirmation — error + empty paths', () => {
  it('returns null + logs warn on a DB error', async () => {
    serverQueue.push({ data: null, error: { message: 'connection reset' } })

    const res = await getOrderForConfirmation(42)
    expect(res).toBeNull()
    expect(mockWarn).toHaveBeenCalled()
    const warnArg = mockWarn.mock.calls[0]?.[0] as { code?: string }
    expect(warnArg?.code).toBe('get_order_failed')
  })

  it('returns null when the row does not exist (maybeSingle returns null data)', async () => {
    serverQueue.push({ data: null, error: null })

    const res = await getOrderForConfirmation(42)
    expect(res).toBeNull()
  })
})

// ===================================================================
// Defensive mapping
// ===================================================================

describe('getOrderForConfirmation — defensive item/grant mapping', () => {
  it('maps missing items array to empty array (no throw)', async () => {
    serverQueue.push({
      data: {
        id: 42,
        user_id: 'user-1',
        status: 'paid',
        subtotal_cents: 5000,
        discount_cents: 0,
        tax_cents: 0,
        total_cents: 5000,
        currency: 'USD',
        email: 'user@example.com',
        paid_at: null,
        created_at: '2026-06-26T09:59:00Z',
        items: undefined,
        grants: [{ id: 1 }],
      },
      error: null,
    })

    const res = await getOrderForConfirmation(42)
    expect(res?.items).toEqual([])
    expect(res?.grant_count).toBe(1)
  })

  it('maps missing grants array to grant_count = 0', async () => {
    serverQueue.push({
      data: {
        id: 42,
        user_id: 'user-1',
        status: 'paid',
        subtotal_cents: 5000,
        discount_cents: 0,
        tax_cents: 0,
        total_cents: 5000,
        currency: 'USD',
        email: 'user@example.com',
        paid_at: null,
        created_at: '2026-06-26T09:59:00Z',
        items: [],
        grants: undefined,
      },
      error: null,
    })

    const res = await getOrderForConfirmation(42)
    expect(res?.grant_count).toBe(0)
  })

  it('maps a missing product join to empty title/slug + null thumbnail (no throw)', async () => {
    serverQueue.push({
      data: {
        id: 42,
        user_id: 'user-1',
        status: 'paid',
        subtotal_cents: 5000,
        discount_cents: 0,
        tax_cents: 0,
        total_cents: 5000,
        currency: 'USD',
        email: 'user@example.com',
        paid_at: null,
        created_at: '2026-06-26T09:59:00Z',
        items: [
          {
            id: 1,
            product_id: 999,
            license: 'plr',
            quantity: 1,
            unit_price_cents: 5000,
            line_total_cents: 5000,
            product: null,
          },
        ],
        grants: [],
      },
      error: null,
    })

    const res = await getOrderForConfirmation(42)
    expect(res?.items).toEqual([
      {
        id: 1,
        product_id: 999,
        license: 'plr',
        quantity: 1,
        unit_price_cents: 5000,
        line_total_cents: 5000,
        title: '',
        thumbnail_url: null,
        slug: '',
      },
    ])
  })
})