// updateQuantity.test.ts — unit tests for the updateQuantityAction
// server action.
//
// Covers:
//   - Auth branch — happy path (cart_items row updated); line not
//     found returns a typed error; qty out-of-bounds (0, 100) is
//     caught by the Zod schema before the DB call.
//   - Anon branch — happy path (cookie line qty is rewritten);
//     invalid anon line id returns a typed error; missing cookie
//     returns a typed error; missing line in cookie returns a typed
//     error.
//   - Input validation — Zod rejects malformed input.
//
// P4.4 — Even though the v1 cart UI no longer renders a quantity
// input (spec: "no quantity selector"), the server action stays
// because the schema (cart_items.quantity check (1..99)) + cookie
// (line.q 1..99) both support bundle-seat semantics in the future.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const revalidateCalls: Array<{ path: string; kind: string | undefined }> = []
vi.mock('next/cache', () => ({
  revalidatePath: (path: string, kind?: string) => {
    revalidateCalls.push({ path, kind })
  },
}))

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

type Call =
  | { method: 'update'; payload: unknown }
  | { method: 'eq'; col: string; val: unknown }

const calls: Call[] = []
let mockUser: { id: string } | null = null
let terminalResponse: { data: unknown; error: unknown } = { data: null, error: null }

function makeChain() {
  const chain: any = {
    update(payload: unknown) {
      calls.push({ method: 'update', payload })
      return chain
    },
    eq(col: string, val: unknown) {
      calls.push({ method: 'eq', col, val })
      return chain
    },
    then(resolve: (v: unknown) => void) {
      resolve(terminalResponse)
    },
  }
  return chain
}

const fakeSupabase = { from: vi.fn(() => makeChain()) }

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

import { ANON_CART_COOKIE } from '@foundations/cookies/anon-cart'

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

const { updateQuantityAction } = await import('./updateQuantity')

beforeEach(() => {
  calls.length = 0
  terminalResponse = { data: null, error: null }
  cookieStore.clear()
  revalidateCalls.length = 0
  mockUser = null
  fakeSupabase.from.mockClear()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('updateQuantityAction — input validation', () => {
  it('rejects quantity 0', async () => {
    const res = await updateQuantityAction({ cart_item_id: 1, quantity: 0 })
    expect(res.ok).toBe(false)
    expect(fakeSupabase.from).not.toHaveBeenCalled()
  })

  it('rejects quantity 100', async () => {
    const res = await updateQuantityAction({ cart_item_id: 1, quantity: 100 })
    expect(res.ok).toBe(false)
    expect(fakeSupabase.from).not.toHaveBeenCalled()
  })

  it('rejects when cart_item_id is missing', async () => {
    const res = await updateQuantityAction({ quantity: 1 })
    expect(res.ok).toBe(false)
    expect(fakeSupabase.from).not.toHaveBeenCalled()
  })
})

describe('updateQuantityAction — auth branch', () => {
  it('updates the row on the happy path', async () => {
    mockUser = { id: 'user-1' }
    terminalResponse = { data: null, error: null }

    const res = await updateQuantityAction({
      cart_item_id: 42,
      quantity: 3,
    })

    expect(res.ok).toBe(true)
    expect(calls.find((c) => c.method === 'update')?.payload).toEqual({ quantity: 3 })
    // user_id + id filters must both apply (RLS + safety).
    expect(
      calls.some((c) => c.method === 'eq' && c.col === 'id' && c.val === 42),
    ).toBe(true)
    expect(
      calls.some((c) => c.method === 'eq' && c.col === 'user_id' && c.val === 'user-1'),
    ).toBe(true)
    expect(revalidateCalls.some((c) => c.path === '/cart')).toBe(true)
  })

  it('returns a typed error when the DB update fails', async () => {
    mockUser = { id: 'user-2' }
    terminalResponse = { data: null, error: { message: 'connection refused' } }

    const res = await updateQuantityAction({
      cart_item_id: 42,
      quantity: 3,
    })

    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/could not update/i)
  })
})

describe('updateQuantityAction — anon branch', () => {
  it('rewrites the line qty in the cookie on the happy path', async () => {
    mockUser = null
    cookieStore.set(
      ANON_CART_COOKIE,
      JSON.stringify({
        v: 1,
        c: '2026-06-25T10:00:00.000Z',
        lines: [{ p: 7, l: 'plr', q: 1, a: '2026-06-25T10:00:00.000Z' }],
      }),
    )

    const res = await updateQuantityAction({
      cart_item_id: 'anon:7:plr',
      quantity: 4,
    })

    expect(res.ok).toBe(true)
    const parsed = JSON.parse(cookieStore.get(ANON_CART_COOKIE) as string)
    expect(parsed.lines[0]).toMatchObject({ p: 7, l: 'plr', q: 4 })
    // added_at is preserved across qty rewrites.
    expect(parsed.lines[0].a).toBe('2026-06-25T10:00:00.000Z')
  })

  it('returns a typed error when the anon line id is malformed', async () => {
    mockUser = null
    const res = await updateQuantityAction({
      cart_item_id: 'not-an-anon-id',
      quantity: 1,
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/invalid/i)
  })

  it('returns a typed error when the cookie is missing', async () => {
    mockUser = null
    const res = await updateQuantityAction({
      cart_item_id: 'anon:7:plr',
      quantity: 1,
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/not found/i)
  })

  it('returns a typed error when the line is not in the cookie', async () => {
    mockUser = null
    cookieStore.set(
      ANON_CART_COOKIE,
      JSON.stringify({ v: 1, c: '2026-06-25T10:00:00.000Z', lines: [] }),
    )
    const res = await updateQuantityAction({
      cart_item_id: 'anon:7:plr',
      quantity: 1,
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/not found/i)
  })
})
