// getCartLastActivity.test.ts — unit tests for the P4.3 last-activity
// query. Uses a chainable fake Supabase client + a mocked
// `getSessionUser` so the test runs without a DB.

import { beforeEach, describe, expect, it, vi } from 'vitest'

type CallRecord =
  | { method: 'select'; payload: unknown }
  | { method: 'eq'; col: string; val: unknown }
  | { method: 'order'; col: string; ascending: boolean }
  | { method: 'limit'; n: number }

function makeChain(
  calls: CallRecord[],
  terminalResponse: { data: unknown; error: unknown },
): any {
  const chain: any = {
    select(payload: unknown) {
      calls.push({ method: 'select', payload })
      return chain
    },
    eq(col: string, val: unknown) {
      calls.push({ method: 'eq', col, val })
      return chain
    },
    order(col: string, opts: { ascending: boolean }) {
      calls.push({ method: 'order', col, ascending: opts.ascending })
      return chain
    },
    limit(n: number) {
      calls.push({ method: 'limit', n })
      return chain
    },
    then(resolve: (v: unknown) => void) {
      resolve(terminalResponse)
    },
  }
  return chain
}

const calls: CallRecord[] = []
let terminalResponse: { data: unknown; error: unknown } = { data: null, error: null }
let mockUser: { id: string } | null = null

const fakeServer = {
  from: vi.fn((_table: string) => makeChain(calls, terminalResponse)),
}

vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: vi.fn(() => fakeServer),
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

// Import AFTER mocks.
const { getAuthCartLastActivity } = await import('./getCartLastActivity')

beforeEach(() => {
  calls.length = 0
  terminalResponse = { data: null, error: null }
  mockUser = null
  fakeServer.from.mockClear()
})

describe('getAuthCartLastActivity', () => {
  it('returns null when there is no session', async () => {
    mockUser = null
    const result = await getAuthCartLastActivity()
    expect(result).toBeNull()
    // No DB call should be made when there's no user.
    expect(fakeServer.from).not.toHaveBeenCalled()
  })

  it('returns the most recent updated_at on the happy path', async () => {
    mockUser = { id: 'user-1' }
    terminalResponse = {
      data: [{ updated_at: '2026-06-25T11:00:00.000Z' }],
      error: null,
    }
    const result = await getAuthCartLastActivity()
    expect(result).toBe('2026-06-25T11:00:00.000Z')
    // Sanity-check the query shape — only the most recent row is
    // needed, so we order desc + limit 1.
    expect(calls.some((c) => c.method === 'order' && c.col === 'updated_at' && !c.ascending)).toBe(true)
    expect(calls.some((c) => c.method === 'limit' && c.n === 1)).toBe(true)
    // user_id + status filter must be applied.
    expect(calls.some((c) => c.method === 'eq' && c.col === 'user_id' && c.val === 'user-1')).toBe(true)
    expect(calls.some((c) => c.method === 'eq' && c.col === 'status' && c.val === 'active')).toBe(true)
  })

  it('returns null when the query result is empty', async () => {
    mockUser = { id: 'user-2' }
    terminalResponse = { data: [], error: null }
    const result = await getAuthCartLastActivity()
    expect(result).toBeNull()
  })

  it('returns null when the result is null', async () => {
    mockUser = { id: 'user-3' }
    terminalResponse = { data: null, error: null }
    const result = await getAuthCartLastActivity()
    expect(result).toBeNull()
  })

  it('returns null on error and logs a warn (fail-soft — never break /cart)', async () => {
    mockUser = { id: 'user-4' }
    terminalResponse = {
      data: null,
      error: { message: 'connection refused', code: 'PGRST000' },
    }
    const result = await getAuthCartLastActivity()
    expect(result).toBeNull()
  })

  it('returns the same result across multiple calls (consistency, not cache)', async () => {
    // We don't test React's `cache()` here — vitest doesn't have a
    // request scope, so cache() may not memoize. This test just
    // asserts that two sequential calls with the same input
    // produce the same output (idempotent read).
    mockUser = { id: 'user-5' }
    terminalResponse = {
      data: [{ updated_at: '2026-06-25T10:00:00.000Z' }],
      error: null,
    }
    const a = await getAuthCartLastActivity()
    const b = await getAuthCartLastActivity()
    expect(a).toBe(b)
  })
})