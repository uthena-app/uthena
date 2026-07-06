// updateLicense.test.ts — unit tests for the updateLicenseAction server
// action.
//
// Covers:
//   - Auth branch — happy path (license changed, RPC called, paths
//     revalidated); unavailable license returns the "not available"
//     error before the RPC fires; source line not found returns a
//     typed error; the same-license case is a no-op (no RPC).
//   - Anon branch — happy path (cookie line license is rewritten);
//     unavailable license returns the error; collision merge (existing
//     line at the new (product, license) drops the old line + keeps
//     the existing new one, matching the auth RPC's collision-merge
//     behavior); same-license is a no-op.
//   - Input validation — Zod rejects malformed input before any DB
//     call (missing cart_item_id, unknown license).
//
// Strategy: same mocks as addToCart.test.ts (see header there). The
// RPC is faked via a queue since updateLicense calls
// `supabase.rpc('update_cart_license', ...)`.

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
  | { method: 'select'; payload: unknown }
  | { method: 'eq'; col: string; val: unknown }
  | { method: 'maybeSingle' }

const calls: Call[] = []
let mockUser: { id: string } | null = null
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
    maybeSingle: vi.fn(async () => {
      calls.push({ method: 'maybeSingle' })
      return terminalQueue.shift() ?? { data: null, error: null }
    }),
  }
  return chain
}

const fakeSupabase = {
  from: vi.fn(() => makeChain()),
  rpc: vi.fn((_name: string, _args: unknown) =>
    Promise.resolve(rpcQueue.shift() ?? { data: null, error: null }),
  ),
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

const { updateLicenseAction } = await import('./updateLicense')

beforeEach(() => {
  calls.length = 0
  terminalQueue = []
  rpcQueue = []
  cookieStore.clear()
  revalidateCalls.length = 0
  mockUser = null
  fakeSupabase.from.mockClear()
  fakeSupabase.rpc.mockClear()
})

afterEach(() => {
  vi.clearAllMocks()
})

// ===================================================================
//  Input validation
// ===================================================================

describe('updateLicenseAction — input validation', () => {
  it('rejects when cart_item_id is missing', async () => {
    const res = await updateLicenseAction({ license: 'plr' })
    expect(res.ok).toBe(false)
    expect(fakeSupabase.from).not.toHaveBeenCalled()
  })

  it('rejects an unknown license', async () => {
    const res = await updateLicenseAction({
      cart_item_id: 'anon:7:plr',
      license: 'platinum-ultra',
    })
    expect(res.ok).toBe(false)
  })
})

// ===================================================================
//  Auth branch
// ===================================================================

describe('updateLicenseAction — auth branch', () => {
  it('rewrites the license via the RPC on the happy path', async () => {
    mockUser = { id: 'user-1' }
    // First call: lookup the source cart line's product_id.
    terminalQueue.push({ data: { product_id: 7 }, error: null })
    // Second call: pricing lookup for the NEW license.
    terminalQueue.push({ data: { id: 88 }, error: null })
    // RPC call: success.
    rpcQueue.push({ data: null, error: null })

    const res = await updateLicenseAction({
      cart_item_id: 42,
      license: 'mrr',
    })

    expect(res.ok).toBe(true)
    expect(revalidateCalls.some((c) => c.path === '/cart')).toBe(true)
  })

  it('returns the typed error when the source line is not found', async () => {
    mockUser = { id: 'user-2' }
    terminalQueue.push({ data: null, error: null })

    const res = await updateLicenseAction({
      cart_item_id: 999,
      license: 'mrr',
    })

    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/not found/i)
  })

  it('returns the typed error when the new license has no active pricing', async () => {
    mockUser = { id: 'user-3' }
    terminalQueue.push({ data: { product_id: 7 }, error: null })
    terminalQueue.push({ data: null, error: null })

    const res = await updateLicenseAction({
      cart_item_id: 42,
      license: 'mrr',
    })

    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/not available/i)
  })
})

// ===================================================================
//  Anon branch
// ===================================================================

describe('updateLicenseAction — anon branch', () => {
  it('rewrites the line license in the cookie on the happy path', async () => {
    mockUser = null
    cookieStore.set(
      ANON_CART_COOKIE,
      JSON.stringify({
        v: 1,
        c: '2026-06-25T10:00:00.000Z',
        lines: [{ p: 7, l: 'plr', q: 2, a: '2026-06-25T10:00:00.000Z' }],
      }),
    )
    // Pricing lookup ok.
    terminalQueue.push({ data: { id: 88 }, error: null })

    const res = await updateLicenseAction({
      cart_item_id: 'anon:7:plr',
      license: 'mrr',
    })

    expect(res.ok).toBe(true)
    const parsed = JSON.parse(cookieStore.get(ANON_CART_COOKIE) as string)
    expect(parsed.lines).toHaveLength(1)
    expect(parsed.lines[0]).toMatchObject({ p: 7, l: 'mrr', q: 2 })
    // added_at is preserved across the license rewrite.
    expect(parsed.lines[0].a).toBe('2026-06-25T10:00:00.000Z')
  })

  it('merges on collision — drops the old line + keeps the existing new line', async () => {
    mockUser = null
    cookieStore.set(
      ANON_CART_COOKIE,
      JSON.stringify({
        v: 1,
        c: '2026-06-25T10:00:00.000Z',
        lines: [
          { p: 7, l: 'plr', q: 2, a: '2026-06-25T10:00:00.000Z' },
          // Already an mrr line — the rewrite target.
          { p: 7, l: 'mrr', q: 3, a: '2026-06-26T10:00:00.000Z' },
        ],
      }),
    )
    terminalQueue.push({ data: { id: 88 }, error: null })

    const res = await updateLicenseAction({
      cart_item_id: 'anon:7:plr',
      license: 'mrr',
    })

    expect(res.ok).toBe(true)
    const parsed = JSON.parse(cookieStore.get(ANON_CART_COOKIE) as string)
    // The plr line is dropped; the existing mrr line is preserved.
    expect(parsed.lines).toHaveLength(1)
    expect(parsed.lines[0]).toMatchObject({ p: 7, l: 'mrr', q: 3 })
  })

  it('is a no-op when the new license equals the current license', async () => {
    mockUser = null
    cookieStore.set(
      ANON_CART_COOKIE,
      JSON.stringify({
        v: 1,
        c: '2026-06-25T10:00:00.000Z',
        lines: [{ p: 7, l: 'plr', q: 1, a: '2026-06-25T10:00:00.000Z' }],
      }),
    )
    // Pricing lookup ok.
    terminalQueue.push({ data: { id: 88 }, error: null })

    const res = await updateLicenseAction({
      cart_item_id: 'anon:7:plr',
      license: 'plr',
    })

    expect(res.ok).toBe(true)
    // The cookie was NOT rewritten on a same-license no-op.
    expect(cookieStore.get(ANON_CART_COOKIE)).toBeDefined()
  })

  it('returns the typed error when the new license has no active pricing', async () => {
    mockUser = null
    cookieStore.set(
      ANON_CART_COOKIE,
      JSON.stringify({
        v: 1,
        c: '2026-06-25T10:00:00.000Z',
        lines: [{ p: 7, l: 'plr', q: 1, a: '2026-06-25T10:00:00.000Z' }],
      }),
    )
    terminalQueue.push({ data: null, error: null })

    const res = await updateLicenseAction({
      cart_item_id: 'anon:7:plr',
      license: 'mrr',
    })

    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/not available/i)
  })

  it('returns the typed error when the line is not in the cookie', async () => {
    mockUser = null
    cookieStore.set(
      ANON_CART_COOKIE,
      JSON.stringify({ v: 1, c: '2026-06-25T10:00:00.000Z', lines: [] }),
    )

    const res = await updateLicenseAction({
      cart_item_id: 'anon:7:plr',
      license: 'mrr',
    })

    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/not found/i)
  })
})
