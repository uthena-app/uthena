// countActiveStreams.test.ts — unit tests for the concurrent-stream
// count query. Same pattern as getDownloadHistory.test.ts: chainable
// fake Supabase + captured calls + mocked getSessionUser + mocked
// logger. Covers:
//   - anon path → 0 + no DB calls
//   - authed happy path → returns count + asserts query shape
//     (user_id, kind='stream', url_expires_at > now, head + exact
//     count)
//   - query failure → fail-soft to 0 + warn log
//   - bigint-as-string count → coerced to number
//   - injected `now` is used as the gt cutoff
//   - PII safety: select payload includes only `id` (no PII fields
//     like ip_raw / ip_hash / user_agent cross the wire)

import { beforeEach, describe, expect, it, vi } from 'vitest'

type CallRecord =
  | { method: 'from'; table: string }
  | { method: 'select'; payload: string; opts: Record<string, unknown> }
  | { method: 'eq'; col: string; val: unknown }
  | { method: 'gt'; col: string; val: string }
  | { method: 'then' }

const calls: CallRecord[] = []
let response: { count: number | string | null; error: { message: string } | null } = {
  count: 0,
  error: null,
}
let mockUser: { id: string } | null = null

// Pin a reference "now" so the gt cutoff is deterministic. The query
// receives `now.toISOString()` as the second arg to `.gt()`.
const NOW = new Date('2026-06-26T12:00:00.000Z')
const NOW_ISO = NOW.toISOString()

function makeChain(terminal: typeof response) {
  const chain: any = {
    select(payload: string, opts: Record<string, unknown> = {}) {
      calls.push({ method: 'select', payload, opts })
      return chain
    },
    eq(col: string, val: unknown) {
      calls.push({ method: 'eq', col, val })
      return chain
    },
    gt(col: string, val: string) {
      calls.push({ method: 'gt', col, val })
      return chain
    },
    then(resolve: (v: unknown) => void) {
      calls.push({ method: 'then' })
      resolve(terminal)
    },
  }
  return chain
}

const fakeServer = {
  from: vi.fn((table: string) => {
    calls.push({ method: 'from', table })
    return makeChain(response)
  }),
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
const { countActiveStreams } = await import('./countActiveStreams')

beforeEach(() => {
  calls.length = 0
  response = { count: 0, error: null }
  mockUser = null
  fakeServer.from.mockClear()
})

// ===========================================================================
// Anon path
// ===========================================================================

describe('countActiveStreams — anon path', () => {
  it('returns 0 + no DB calls when there is no session', async () => {
    mockUser = null
    const count = await countActiveStreams(NOW)
    expect(count).toBe(0)
    expect(fakeServer.from).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// Happy path
// ===========================================================================

describe('countActiveStreams — happy path', () => {
  it('queries file_downloads scoped to user_id + kind=stream + url_expires_at > now', async () => {
    mockUser = { id: 'user-1' }
    response = { count: 2, error: null }
    const count = await countActiveStreams(NOW)
    expect(count).toBe(2)
    // from(file_downloads)
    expect(calls.some((c) => c.method === 'from' && c.table === 'file_downloads')).toBe(true)
    // .eq(user_id, 'user-1')
    expect(calls.some((c) => c.method === 'eq' && c.col === 'user_id' && c.val === 'user-1')).toBe(true)
    // .eq(kind, 'stream')
    expect(calls.some((c) => c.method === 'eq' && c.col === 'kind' && c.val === 'stream')).toBe(true)
    // .gt(url_expires_at, NOW_ISO)
    expect(calls.some((c) => c.method === 'gt' && c.col === 'url_expires_at' && c.val === NOW_ISO)).toBe(true)
  })

  it('uses head:true + count:exact for the cheapest possible count query', async () => {
    mockUser = { id: 'user-1' }
    response = { count: 3, error: null }
    await countActiveStreams(NOW)
    const select = calls.find((c) => c.method === 'select')
    expect(select).toBeDefined()
    if (select && select.method === 'select') {
      expect(select.opts).toMatchObject({ count: 'exact', head: true })
      expect(select.payload).toBe('id')
    }
  })

  it('returns 0 for a user with no active streams', async () => {
    mockUser = { id: 'user-2' }
    response = { count: 0, error: null }
    expect(await countActiveStreams(NOW)).toBe(0)
  })

  it('returns large counts correctly', async () => {
    mockUser = { id: 'user-3' }
    response = { count: 47, error: null }
    expect(await countActiveStreams(NOW)).toBe(47)
  })
})

// ===========================================================================
// Bigint-as-string defensive coercion
// ===========================================================================

describe('countActiveStreams — bigint-as-string defensive coercion', () => {
  it('coerces a string count to a number', async () => {
    mockUser = { id: 'user-1' }
    response = { count: '5', error: null }
    expect(await countActiveStreams(NOW)).toBe(5)
  })

  it('returns 0 for an unparseable string count', async () => {
    mockUser = { id: 'user-1' }
    response = { count: 'not-a-number', error: null }
    expect(await countActiveStreams(NOW)).toBe(0)
  })

  it('returns 0 for null count', async () => {
    mockUser = { id: 'user-1' }
    response = { count: null, error: null }
    expect(await countActiveStreams(NOW)).toBe(0)
  })

  it('clamps a negative count to 0 (defensive)', async () => {
    mockUser = { id: 'user-1' }
    response = { count: -1, error: null }
    expect(await countActiveStreams(NOW)).toBe(0)
  })
})

// ===========================================================================
// Fail-soft
// ===========================================================================

describe('countActiveStreams — fail-soft', () => {
  it('returns 0 when the query errors (does not throw)', async () => {
    mockUser = { id: 'user-1' }
    response = { count: null, error: { message: 'connection refused' } }
    expect(await countActiveStreams(NOW)).toBe(0)
  })
})

// ===========================================================================
// PII safety
// ===========================================================================

describe('countActiveStreams — PII safety', () => {
  it('select payload is just `id` (no ip_raw / ip_hash / user_agent)', async () => {
    mockUser = { id: 'user-1' }
    response = { count: 1, error: null }
    await countActiveStreams(NOW)
    const select = calls.find((c) => c.method === 'select')
    expect(select).toBeDefined()
    if (select && select.method === 'select') {
      // The payload must be exactly `id` — no PII columns cross the
      // wire. Asserting the exact payload (not just a substring) is
      // the only way to catch a future regression that adds columns.
      expect(select.payload).toBe('id')
    }
  })
})

// ===========================================================================
// Injectable now
// ===========================================================================

describe('countActiveStreams — injectable now', () => {
  it('passes the injected now to the gt cutoff', async () => {
    mockUser = { id: 'user-1' }
    response = { count: 1, error: null }
    const customNow = new Date('2026-01-15T08:30:00.000Z')
    await countActiveStreams(customNow)
    expect(calls.some((c) => c.method === 'gt' && c.val === customNow.toISOString())).toBe(true)
  })

  it('falls back to Date.now() when no now is passed', async () => {
    mockUser = { id: 'user-1' }
    response = { count: 1, error: null }
    const before = Date.now()
    await countActiveStreams()
    const after = Date.now()
    const gtCall = calls.find((c) => c.method === 'gt')
    expect(gtCall).toBeDefined()
    if (gtCall && gtCall.method === 'gt') {
      const cutoff = Date.parse(gtCall.val)
      // The cutoff was generated somewhere between `before` and
      // `after`. Allow 50ms slack for clock skew between the test
      // runner's Date.now() and the query helper's Date.now().
      expect(cutoff).toBeGreaterThanOrEqual(before - 50)
      expect(cutoff).toBeLessThanOrEqual(after + 50)
    }
  })
})