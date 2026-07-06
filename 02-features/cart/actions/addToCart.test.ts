// addToCart.test.ts — unit tests for the addToCartAction server action.
//
// Covers:
//   - Auth branch — happy path (product exists, license active, line
//     created); re-add same (product, license) is idempotent (returns
//     the existing id, doesn't bump qty); invalid license returns the
//     "not available" error; the upsert's `ignoreDuplicates` path
//     falls back to a re-select.
//   - Anon branch — happy path (writes cookie with the new line);
//     re-add same (product, license) is idempotent (existing line is
//     preserved); invalid license returns the same error; the
//     synthesized anon line id follows the canonical `anon:<pid>:<l>`
//     shape.
//   - Input validation — Zod rejects malformed input before any DB
//     call (cart_item_id missing, license invalid, quantity < 1 or
//     > 99).
//
// Strategy: vi.mock `next/cache` (so revalidatePath is observable but
// harmless), `next/headers` (so `cookies()` returns a controllable
// store), `@foundations/data/supabase` (so getServerSupabase() returns
// a chainable fake client), `@foundations/auth/guards` (so
// getSessionUser is controllable), `@foundations/log/pino` (so log
// calls don't print), and `@foundations/cookies/anon-cart` (so the
// cookie store is in-memory).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ----- Mock next/cache (revalidatePath is observable, harmless) ----
const revalidateCalls: Array<{ path: string; kind: string | undefined }> = []
vi.mock('next/cache', () => ({
  revalidatePath: (path: string, kind?: string) => {
    revalidateCalls.push({ path, kind })
  },
}))

// ----- Mock next/headers cookies() -------------------------------
const cookieStore = new Map<string, string>()
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => {
      const v = cookieStore.get(name)
      return v ? { name, value: v } : undefined
    },
    set: (name: string, value: string) => {
      cookieStore.set(name, value)
    },
    delete: (name: string) => {
      cookieStore.delete(name)
    },
  })),
}))

// ----- Mock getServerSupabase with a chainable fake --------------
type Call =
  | { method: 'select'; payload: unknown }
  | { method: 'eq'; col: string; val: unknown }
  | { method: 'in'; col: string; vals: unknown[] }
  | { method: 'maybeSingle' }
  | { method: 'single' }
  | { method: 'upsert'; payload: unknown; opts: unknown }
  | { method: 'insert'; payload: unknown }
  | { method: 'update'; payload: unknown }
  | { method: 'delete' }

const calls: Call[] = []
let mockUser: { id: string } | null = null
// Sequence of terminal responses — one per awaited terminal call
// (single / maybeSingle / then). The fake pops in order.
let terminalQueue: Array<{ data: unknown; error: unknown }> = []
let rpcQueue: Array<{ data: unknown; error: unknown }> = []

function makeChain() {
  const chain: any = {
    select(payload: unknown) {
      calls.push({ method: 'select', payload })
      return chain
    },
    eq(col: string, val: unknown) {
      calls.push({ method: 'eq', col, val })
      return chain
    },
    in(col: string, vals: unknown[]) {
      calls.push({ method: 'in', col, vals })
      return chain
    },
    upsert(payload: unknown, opts: unknown) {
      calls.push({ method: 'upsert', payload, opts })
      return chain
    },
    insert(payload: unknown) {
      calls.push({ method: 'insert', payload })
      return chain
    },
    update(payload: unknown) {
      calls.push({ method: 'update', payload })
      return chain
    },
    delete() {
      calls.push({ method: 'delete' })
      return chain
    },
    maybeSingle: vi.fn(async () => {
      calls.push({ method: 'maybeSingle' })
      const next = terminalQueue.shift() ?? { data: null, error: null }
      return next
    }),
    single: vi.fn(async () => {
      calls.push({ method: 'single' })
      const next = terminalQueue.shift() ?? { data: null, error: null }
      return next
    }),
    rpc(name: string, _args: unknown) {
      // .rpc(name, args) returns a Promise directly. We pop the rpc queue.
      const next = rpcQueue.shift() ?? { data: null, error: null }
      return Promise.resolve(next)
    },
  }
  return chain
}

const fakeSupabase = {
  from: vi.fn(() => makeChain()),
  rpc: vi.fn((name: string, _args: unknown) => {
    // The action calls supabase.rpc('has_active_subscription', {p_user_id}).
    // Pop the rpcQueue; default to {data:null, error:null} if no fixture.
    const next = rpcQueue.shift() ?? { data: null, error: null }
    return Promise.resolve(next)
  }),
}

vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: vi.fn(() => fakeSupabase),
}))

vi.mock('@foundations/auth/guards', () => ({
  getSessionUser: vi.fn(async () => mockUser),
}))

vi.mock('@foundations/log/pino', () => ({
  loggerFor: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

// ----- Mock the anon-cart cookie helpers -----------------------
// The real helpers sign/verify; we test the action with a plain
// in-memory store keyed on the ANON_CART_COOKIE name.
import { ANON_CART_COOKIE, ANON_CART_MAX_LINES } from '@foundations/cookies/anon-cart'

vi.mock('@foundations/cookies/anon-cart', async () => {
  const actual = await vi.importActual<typeof import('@foundations/cookies/anon-cart')>(
    '@foundations/cookies/anon-cart',
  )
  return {
    ...actual,
    readAnonCart: vi.fn(async () => {
      const raw = cookieStore.get(ANON_CART_COOKIE)
      if (!raw) return null
      try {
        return JSON.parse(raw) as {
          v: number
          c?: string
          lines: Array<{ p: number; l: string; q: number; a: string }>
        }
      } catch {
        return null
      }
    }),
    writeAnonCart: vi.fn(
      async (cart: {
        v: number
        c?: string
        lines: Array<{ p: number; l: string; q: number; a: string }>
      }) => {
        cookieStore.set(ANON_CART_COOKIE, JSON.stringify(cart))
      },
    ),
  }
})

// ----- Import after mocks ---------------------------------------
const { addToCartAction } = await import('./addToCart')

beforeEach(() => {
  calls.length = 0
  terminalQueue = []
  rpcQueue = []
  cookieStore.clear()
  revalidateCalls.length = 0
  mockUser = null
  fakeSupabase.from.mockClear()
})

afterEach(() => {
  vi.clearAllMocks()
})

// ===================================================================
//  Input validation
// ===================================================================

describe('addToCartAction — input validation', () => {
  it('rejects when cart_item_id is missing on the input object', async () => {
    // Note: addToCartAction takes product_id + license + quantity —
    // we use a malformed object to trigger the Zod safeParse path.
    const res = await addToCartAction({
      // product_id missing
      license: 'plr',
      quantity: 1,
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/invalid/i)
    // No DB call should have been made.
    expect(fakeSupabase.from).not.toHaveBeenCalled()
  })

  it('rejects an unknown license', async () => {
    const res = await addToCartAction({
      product_id: 1,
      license: 'platinum-ultra',
      quantity: 1,
    })
    expect(res.ok).toBe(false)
    expect(fakeSupabase.from).not.toHaveBeenCalled()
  })

  it('rejects quantity < 1', async () => {
    const res = await addToCartAction({
      product_id: 1,
      license: 'plr',
      quantity: 0,
    })
    expect(res.ok).toBe(false)
  })

  it('rejects quantity > 99', async () => {
    const res = await addToCartAction({
      product_id: 1,
      license: 'plr',
      quantity: 100,
    })
    expect(res.ok).toBe(false)
  })
})

// ===================================================================
//  Auth branch
// ===================================================================

describe('addToCartAction — auth branch', () => {
  it('creates a new line on the happy path', async () => {
    mockUser = { id: 'user-1' }
    // First call: pricing lookup
    terminalQueue.push({ data: { id: 99 }, error: null })
    // Second call: upsert + select single
    terminalQueue.push({ data: { id: 42 }, error: null })

    const res = await addToCartAction({
      product_id: 7,
      license: 'plr',
      quantity: 1,
    })

    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.source).toBe('auth')
      expect(res.cart_item_id).toBe(42)
    }
    // Should have queried product_pricing first.
    expect(calls[0]?.method).toBe('select')
    // Should have issued an upsert with the right shape.
    const upsertCall = calls.find((c) => c.method === 'upsert')
    expect(upsertCall).toBeDefined()
    expect(revalidateCalls.some((c) => c.path === '/cart')).toBe(true)
  })

  it('returns the typed error when the product has no active pricing for the license', async () => {
    mockUser = { id: 'user-2' }
    // Pricing lookup returns no row → fail closed.
    terminalQueue.push({ data: null, error: null })

    const res = await addToCartAction({
      product_id: 7,
      license: 'mrr',
      quantity: 1,
    })

    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/not available/i)
  })

  it('re-add same (product, license) is idempotent — re-selects the existing row', async () => {
    mockUser = { id: 'user-3' }
    // Pricing lookup ok.
    terminalQueue.push({ data: { id: 99 }, error: null })
    // Upsert returns a duplicate-key error (the ignoreDuplicates
    // path fires the fallback re-select).
    terminalQueue.push({
      data: null,
      error: { code: 'PGRST116', message: 'duplicate key value violates unique constraint' },
    })
    // Re-select returns the existing row.
    terminalQueue.push({ data: { id: 555 }, error: null })

    const res = await addToCartAction({
      product_id: 7,
      license: 'plr',
      quantity: 1,
    })

    expect(res.ok).toBe(true)
    if (res.ok) expect(res.cart_item_id).toBe(555)
  })
})

// ===================================================================
//  Anon branch
// ===================================================================

describe('addToCartAction — anon branch', () => {
  it('writes a fresh cookie on the happy path', async () => {
    mockUser = null
    // Pricing lookup returns a row with the product status joined.
    terminalQueue.push({
      data: { id: 99, product: { status: 'published' } },
      error: null,
    })

    const res = await addToCartAction({
      product_id: 7,
      license: 'plr',
      quantity: 1,
    })

    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.source).toBe('anon')
      expect(res.cart_item_id).toBe('anon:7:plr')
    }
    // Cookie should now carry the new line.
    const raw = cookieStore.get(ANON_CART_COOKIE)
    expect(raw).toBeDefined()
    const parsed = JSON.parse(raw as string)
    expect(parsed.lines).toHaveLength(1)
    expect(parsed.lines[0]).toMatchObject({ p: 7, l: 'plr', q: 1 })
  })

  it('re-add same (product, license) is idempotent — existing line is kept', async () => {
    mockUser = null
    // Seed the cookie with an existing line at (7, 'plr').
    cookieStore.set(
      ANON_CART_COOKIE,
      JSON.stringify({
        v: 1,
        c: '2026-06-25T10:00:00.000Z',
        lines: [{ p: 7, l: 'plr', q: 1, a: '2026-06-25T10:00:00.000Z' }],
      }),
    )
    terminalQueue.push({
      data: { id: 99, product: { status: 'published' } },
      error: null,
    })

    const res = await addToCartAction({
      product_id: 7,
      license: 'plr',
      quantity: 1,
    })

    expect(res.ok).toBe(true)
    if (res.ok) expect(res.cart_item_id).toBe('anon:7:plr')
    // Still one line, not two.
    const parsed = JSON.parse(cookieStore.get(ANON_CART_COOKIE) as string)
    expect(parsed.lines).toHaveLength(1)
  })

  it('rejects when the product is unpublished', async () => {
    mockUser = null
    terminalQueue.push({
      data: { id: 99, product: { status: 'draft' } },
      error: null,
    })

    const res = await addToCartAction({
      product_id: 7,
      license: 'plr',
      quantity: 1,
    })

    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/not currently available/i)
  })

  it('rejects when the cookie is already at the max-line cap', async () => {
    mockUser = null
    // Seed the cookie at the cap with lines that don't include the
    // new (product, license) pair so the upsert path tries to push.
    cookieStore.set(
      ANON_CART_COOKIE,
      JSON.stringify({
        v: 1,
        c: '2026-06-25T10:00:00.000Z',
        lines: Array.from({ length: ANON_CART_MAX_LINES }).map((_, i) => ({
          p: 100 + i, // distinct product ids; none collide with the new one
          l: 'plr',
          q: 1,
          a: '2026-06-25T10:00:00.000Z',
        })),
      }),
    )
    terminalQueue.push({
      data: { id: 99, product: { status: 'published' } },
      error: null,
    })

    const res = await addToCartAction({
      product_id: 7,
      license: 'plr',
      quantity: 1,
    })

    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/cart is full/i)
  })
})

// ===================================================================
//  P8.3 — Subscriber-only gate (auth + anon branches)
// ===================================================================

describe('addToCartAction — P8.3 subscriber-only gate (auth branch)', () => {
  it('refuses to add a subscriber-only product when the user has no active subscription', async () => {
    mockUser = { id: 'user-sub-test-1' }
    // Pricing lookup returns the row with the product join — subscriber_only=true.
    terminalQueue.push({
      data: { id: 99, product: { id: 7, status: 'published', subscriber_only: true } },
      error: null,
    })
    // has_active_subscription RPC returns false.
    rpcQueue.push({ data: false, error: null })

    const res = await addToCartAction({
      product_id: 7,
      license: 'plr',
      quantity: 1,
    })

    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.subscriberOnly).toBe(true)
      expect(res.error).toMatch(/Personal Access/i)
    }
    // The upsert must NOT have been called — the gate refused first.
    const upsertCall = calls.find((c) => c.method === 'upsert')
    expect(upsertCall).toBeUndefined()
  })

  it('allows a subscriber-only product when the user has an active subscription', async () => {
    mockUser = { id: 'user-sub-test-2' }
    // Pricing lookup returns the row with the product join — subscriber_only=true.
    terminalQueue.push({
      data: { id: 99, product: { id: 7, status: 'published', subscriber_only: true } },
      error: null,
    })
    // has_active_subscription RPC returns true.
    rpcQueue.push({ data: true, error: null })
    // Upsert returns the new line id.
    terminalQueue.push({ data: { id: 42 }, error: null })

    const res = await addToCartAction({
      product_id: 7,
      license: 'plr',
      quantity: 1,
    })

    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.source).toBe('auth')
      expect(res.cart_item_id).toBe(42)
    }
  })

  it('refuses a subscriber-only product when the has_active_subscription RPC errors (fail-closed)', async () => {
    mockUser = { id: 'user-sub-test-3' }
    terminalQueue.push({
      data: { id: 99, product: { id: 7, status: 'published', subscriber_only: true } },
      error: null,
    })
    rpcQueue.push({
      data: null,
      error: { message: 'connection refused', code: 'PGRST000' },
    })

    const res = await addToCartAction({
      product_id: 7,
      license: 'plr',
      quantity: 1,
    })

    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.subscriberOnly).toBe(true)
    const upsertCall = calls.find((c) => c.method === 'upsert')
    expect(upsertCall).toBeUndefined()
  })

  it('does NOT call has_active_subscription for a non-subscriber-only product (gate is opt-in)', async () => {
    mockUser = { id: 'user-sub-test-4' }
    terminalQueue.push({
      data: { id: 99, product: { id: 7, status: 'published', subscriber_only: false } },
      error: null,
    })
    terminalQueue.push({ data: { id: 42 }, error: null })
    // No rpcQueue entry — if the source calls .rpc() we'll see undefined.

    const res = await addToCartAction({
      product_id: 7,
      license: 'plr',
      quantity: 1,
    })

    expect(res.ok).toBe(true)
    if (res.ok) expect(res.cart_item_id).toBe(42)
    // The source never called .rpc() — the rpcQueue should still be empty.
    // (No assertion needed beyond the ok=true check; the rpcQueue would
    // have shifted if the gate fired.)
  })

  it('does NOT call has_active_subscription when the product join omits subscriber_only (defensive)', async () => {
    mockUser = { id: 'user-sub-test-5' }
    terminalQueue.push({
      data: { id: 99, product: { id: 7, status: 'published' } },
      error: null,
    })
    terminalQueue.push({ data: { id: 42 }, error: null })

    const res = await addToCartAction({
      product_id: 7,
      license: 'plr',
      quantity: 1,
    })

    expect(res.ok).toBe(true)
    if (res.ok) expect(res.cart_item_id).toBe(42)
  })
})

describe('addToCartAction — P8.3 subscriber-only gate (anon branch)', () => {
  it('refuses to add a subscriber-only product to an anon cart', async () => {
    mockUser = null
    terminalQueue.push({
      data: { id: 99, product: { id: 7, status: 'published', subscriber_only: true } },
      error: null,
    })

    const res = await addToCartAction({
      product_id: 7,
      license: 'plr',
      quantity: 1,
    })

    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.subscriberOnly).toBe(true)
      expect(res.error).toMatch(/Personal Access/i)
    }
    // The cookie must not have been written.
    expect(cookieStore.get(ANON_CART_COOKIE)).toBeUndefined()
  })

  it('still allows a non-subscriber-only product to an anon cart', async () => {
    mockUser = null
    terminalQueue.push({
      data: { id: 99, product: { id: 7, status: 'published', subscriber_only: false } },
      error: null,
    })

    const res = await addToCartAction({
      product_id: 7,
      license: 'plr',
      quantity: 1,
    })

    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.source).toBe('anon')
      expect(res.cart_item_id).toBe('anon:7:plr')
    }
    const raw = cookieStore.get(ANON_CART_COOKIE)
    expect(raw).toBeDefined()
  })
})
