// removeLine.test.ts — unit tests for the removeLineAction server
// action.
//
// Covers:
//   - Auth branch — happy path (cart_items row deleted via
//     `id + user_id` filter); DB error returns a typed error.
//   - Anon branch — happy path (cookie line is filtered out); bad
//     anon id returns a typed error; missing cookie returns a typed
//     error; line not present in the cookie returns a typed error
//     (the action's "no-op on missing" guard).
//   - Input validation — Zod rejects missing cart_item_id.

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
  | { method: 'delete' }
  | { method: 'eq'; col: string; val: unknown }

const calls: Call[] = []
let mockUser: { id: string } | null = null
let terminalResponse: { data: unknown; error: unknown } = { data: null, error: null }

function makeChain() {
  const chain: any = {
    delete() {
      calls.push({ method: 'delete' })
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

const { removeLineAction } = await import('./removeLine')

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

describe('removeLineAction — input validation', () => {
  it('rejects when cart_item_id is missing', async () => {
    const res = await removeLineAction({})
    expect(res.ok).toBe(false)
    expect(fakeSupabase.from).not.toHaveBeenCalled()
  })
})

describe('removeLineAction — auth branch', () => {
  it('deletes the row on the happy path (id + user_id filters)', async () => {
    mockUser = { id: 'user-1' }
    terminalResponse = { data: null, error: null }

    const res = await removeLineAction({ cart_item_id: 42 })

    expect(res.ok).toBe(true)
    expect(calls.some((c) => c.method === 'delete')).toBe(true)
    expect(
      calls.some((c) => c.method === 'eq' && c.col === 'id' && c.val === 42),
    ).toBe(true)
    expect(
      calls.some((c) => c.method === 'eq' && c.col === 'user_id' && c.val === 'user-1'),
    ).toBe(true)
    expect(revalidateCalls.some((c) => c.path === '/cart')).toBe(true)
  })

  it('returns a typed error when the DB delete fails', async () => {
    mockUser = { id: 'user-2' }
    terminalResponse = { data: null, error: { message: 'connection refused' } }

    const res = await removeLineAction({ cart_item_id: 42 })

    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/could not remove/i)
  })
})

describe('removeLineAction — anon branch', () => {
  it('removes the matching line from the cookie on the happy path', async () => {
    mockUser = null
    cookieStore.set(
      ANON_CART_COOKIE,
      JSON.stringify({
        v: 1,
        c: '2026-06-25T10:00:00.000Z',
        lines: [
          { p: 7, l: 'plr', q: 1, a: '2026-06-25T10:00:00.000Z' },
          { p: 8, l: 'plr', q: 2, a: '2026-06-25T10:30:00.000Z' },
        ],
      }),
    )

    const res = await removeLineAction({ cart_item_id: 'anon:7:plr' })

    expect(res.ok).toBe(true)
    const parsed = JSON.parse(cookieStore.get(ANON_CART_COOKIE) as string)
    expect(parsed.lines).toHaveLength(1)
    expect(parsed.lines[0]).toMatchObject({ p: 8, l: 'plr' })
  })

  it('returns a typed error when the anon line id is malformed', async () => {
    mockUser = null
    const res = await removeLineAction({ cart_item_id: 'not-an-anon-id' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/invalid/i)
  })

  it('returns a typed error when the cookie is missing', async () => {
    mockUser = null
    const res = await removeLineAction({ cart_item_id: 'anon:7:plr' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/not found/i)
  })

  it('returns a typed error when the line is not present in the cookie (no-op guard)', async () => {
    mockUser = null
    cookieStore.set(
      ANON_CART_COOKIE,
      JSON.stringify({
        v: 1,
        c: '2026-06-25T10:00:00.000Z',
        lines: [{ p: 7, l: 'plr', q: 1, a: '2026-06-25T10:00:00.000Z' }],
      }),
    )

    const res = await removeLineAction({ cart_item_id: 'anon:99:mrr' })

    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/not found/i)
    // Cookie was NOT rewritten when the line wasn't present.
    const parsed = JSON.parse(cookieStore.get(ANON_CART_COOKIE) as string)
    expect(parsed.lines).toHaveLength(1)
  })
})
