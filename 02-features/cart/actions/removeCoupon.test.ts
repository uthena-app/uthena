// removeCouponAction.test.ts — unit tests for the removeCouponAction
// server action.
//
// Covers:
//   - Auth branch — happy path (detaches from every active cart line
//     with a non-null coupon_id); returns the line count for telemetry.
//   - Auth branch — idempotent (no active coupon applied → ok with
//     removed_lines: 0; no UPDATE fires).
//   - Auth branch — DB error on the read returns the typed error.
//   - Auth branch — DB error on the UPDATE returns the typed error.
//   - Anon branch — rejected (action requires auth).
//
// Strategy mirrors applyCouponAction.test.ts: vi.mock `next/cache`,
// `next/headers`, the Supabase client (chainable fake), the auth guard,
// and the pino logger. The `removeCoupon` action does NOT call rpc()
// (no has_active_subscription dependency), so the test fake doesn't
// need an rpcQueue.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ----- Mock next/cache ----------------------------------------------
const revalidateCalls: Array<{ path: string; kind: string | undefined }> = []
vi.mock('next/cache', () => ({
  revalidatePath: (path: string, kind?: string) => {
    revalidateCalls.push({ path, kind })
  },
}))

// ----- Mock next/headers cookies() ---------------------------------
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

// ----- Mock getServerSupabase with a chainable fake ---------------
type Call =
  | { method: 'select'; payload: unknown }
  | { method: 'eq'; col: string; val: unknown }
  | { method: 'in'; col: string; vals: unknown[] }
  | { method: 'not'; col: string; op: string; val: unknown }
  | { method: 'update'; payload: unknown }
  | { method: 'delete' }

type NotCall = Extract<Call, { method: 'not' }>
type InCall = Extract<Call, { method: 'in' }>
type UpdateCall = Extract<Call, { method: 'update' }>

const calls: Call[] = []
let mockUser: { id: string } | null = null
let terminalQueue: Array<{ data: unknown; error: unknown }> = []

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
    not(col: string, op: string, val: unknown) {
      calls.push({ method: 'not', col, op, val })
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
    then(resolve: (v: unknown) => unknown) {
      const next = terminalQueue.shift() ?? { data: [], error: null }
      return Promise.resolve(next).then(resolve)
    },
    rpc(name: string, _args: unknown) {
      // unused by removeCoupon, but the fake needs it for safety
      return Promise.resolve({ data: null, error: null })
    },
  }
  return chain
}

const fakeSupabase = {
  from: vi.fn(() => makeChain()),
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

// ----- Import after mocks -----------------------------------------
const { removeCouponAction } = await import('./removeCoupon')

beforeEach(() => {
  calls.length = 0
  terminalQueue = []
  cookieStore.clear()
  revalidateCalls.length = 0
  mockUser = null
  fakeSupabase.from.mockClear()
})

afterEach(() => {
  vi.clearAllMocks()
})

// ===================================================================
//  Auth gating
// ===================================================================

describe('removeCouponAction — auth gating', () => {
  it('rejects anonymous users', async () => {
    mockUser = null
    const res = await removeCouponAction()
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/sign in/i)
    expect(fakeSupabase.from).not.toHaveBeenCalled()
  })
})

// ===================================================================
//  Happy path
// ===================================================================

describe('removeCouponAction — happy path', () => {
  it('detaches the coupon from every active cart line with a coupon', async () => {
    mockUser = { id: 'user-1' }
    // Read returns 2 active cart lines with coupon_id != null
    terminalQueue.push({
      data: [{ id: 1 }, { id: 2 }],
      error: null,
    })
    // Update returns success
    terminalQueue.push({ data: null, error: null })

    const res = await removeCouponAction()
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.removed_lines).toBe(2)

    // Should have filtered the read with .not('coupon_id', 'is', null)
    const notCall = calls.find((c): c is NotCall => c.method === 'not' && c.col === 'coupon_id')
    expect(notCall).toBeDefined()
    expect(notCall?.op).toBe('is')
    expect(notCall?.val).toBe(null)

    // Should have issued an UPDATE with .in('id', [1, 2])
    const inCall = calls.find((c): c is InCall => c.method === 'in' && c.col === 'id')
    expect(inCall?.vals).toEqual([1, 2])

    // Update payload should clear coupon_id
    const updateCall = calls.find((c): c is UpdateCall => c.method === 'update')
    expect(updateCall?.payload).toEqual({ coupon_id: null })

    // Both /cart and /checkout should be revalidated
    expect(revalidateCalls.some((c) => c.path === '/cart')).toBe(true)
    expect(revalidateCalls.some((c) => c.path === '/checkout')).toBe(true)
  })

  it('is idempotent when no coupon is applied (no UPDATE, no error)', async () => {
    mockUser = { id: 'user-1' }
    terminalQueue.push({ data: [], error: null }) // read returns empty

    const res = await removeCouponAction()
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.removed_lines).toBe(0)

    // No update should have been issued
    const updateCall = calls.find((c) => c.method === 'update')
    expect(updateCall).toBeUndefined()

    // Revalidation still fires (consistent with the success path)
    expect(revalidateCalls.some((c) => c.path === '/cart')).toBe(true)
  })
})

// ===================================================================
//  Error paths
// ===================================================================

describe('removeCouponAction — error paths', () => {
  it('returns a typed error when the read query fails', async () => {
    mockUser = { id: 'user-1' }
    terminalQueue.push({ data: null, error: { message: 'db down' } })

    const res = await removeCouponAction()
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/try again/i)
  })

  it('returns a typed error when the UPDATE fails', async () => {
    mockUser = { id: 'user-1' }
    terminalQueue.push({ data: [{ id: 1 }], error: null })
    terminalQueue.push({ data: null, error: { message: 'rls violation' } })

    const res = await removeCouponAction()
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/try again/i)
  })
})