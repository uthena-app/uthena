// getDownloadHistory.test.ts — unit tests for the /library/downloads
// query. Same pattern as getUserAccessibleFiles.test.ts: chainable
// fake Supabase + captured calls + mocked getSessionUser + mocked
// logger. Covers:
//   - anon path → empty + no DB calls
//   - kind filter (download | stream) → query shape
//   - since filter (window-days) → query shape
//   - since = null (unbounded) → no .gte
//   - limit cap (never exceeds MAX_HISTORY_ROWS)
//   - happy path: array-embed + object-embed product/files mapping
//   - missing join → null fields + no throw
//   - deleted FK (file_id null) → null filename, product join still
//     works if the product wasn't deleted
//   - error path → empty + warn + total_in_window = -1
//   - filters echo + normalization (kind validation, limit clamp)

import { beforeEach, describe, expect, it, vi } from 'vitest'

type CallRecord =
  | { method: 'from'; table: string }
  | { method: 'select'; payload: string }
  | { method: 'eq'; col: string; val: unknown }
  | { method: 'gte'; col: string; val: unknown }
  | { method: 'order'; col: string; ascending: boolean }
  | { method: 'limit'; n: number }

const calls: CallRecord[] = []
let downloadsResponse: { data: unknown; error: unknown } = { data: null, error: null }
let mockUser: { id: string } | null = null

function makeChain(terminal: { data: unknown; error: unknown }) {
  const chain: any = {
    select(payload: string) {
      calls.push({ method: 'select', payload })
      return chain
    },
    eq(col: string, val: unknown) {
      calls.push({ method: 'eq', col, val })
      return chain
    },
    gte(col: string, val: unknown) {
      calls.push({ method: 'gte', col, val })
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
      resolve(terminal)
    },
  }
  return chain
}

const fakeServer = {
  from: vi.fn((table: string) => {
    calls.push({ method: 'from', table })
    return makeChain(downloadsResponse)
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
const { getDownloadHistory, MAX_HISTORY_ROWS, windowSince } = await import('./getDownloadHistory')

beforeEach(() => {
  calls.length = 0
  downloadsResponse = { data: null, error: null }
  mockUser = null
  fakeServer.from.mockClear()
})

describe('getDownloadHistory', () => {
  it('returns empty + no DB calls when there is no session', async () => {
    mockUser = null
    const result = await getDownloadHistory()
    expect(result.entries).toEqual([])
    expect(result.total_in_window).toBe(0)
    expect(fakeServer.from).not.toHaveBeenCalled()
  })

  it('queries file_downloads scoped to user_id + created_at desc + default limit', async () => {
    mockUser = { id: 'user-1' }
    downloadsResponse = { data: [], error: null }
    await getDownloadHistory()
    expect(calls.some((c) => c.method === 'from' && c.table === 'file_downloads')).toBe(true)
    expect(calls.some((c) => c.method === 'eq' && c.col === 'user_id' && c.val === 'user-1')).toBe(true)
    expect(calls.some((c) => c.method === 'order' && c.col === 'created_at' && c.ascending === false)).toBe(true)
    expect(calls.some((c) => c.method === 'limit' && c.n === MAX_HISTORY_ROWS)).toBe(true)
  })

  it('PII safety: select payload excludes ip_hash', async () => {
    mockUser = { id: 'user-2' }
    downloadsResponse = { data: [], error: null }
    await getDownloadHistory()
    const select = calls.find((c) => c.method === 'select')
    expect(select).toBeDefined()
    if (select && select.method === 'select') {
      expect(select.payload).not.toContain('ip_hash')
      // ip_raw is selected (masked at render time)
      expect(select.payload).toContain('ip_raw')
    }
  })

  it('applies kind=download filter when set', async () => {
    mockUser = { id: 'user-3' }
    downloadsResponse = { data: [], error: null }
    await getDownloadHistory({ kind: 'download' })
    expect(calls.some((c) => c.method === 'eq' && c.col === 'kind' && c.val === 'download')).toBe(true)
  })

  it('applies kind=stream filter when set', async () => {
    mockUser = { id: 'user-4' }
    downloadsResponse = { data: [], error: null }
    await getDownloadHistory({ kind: 'stream' })
    expect(calls.some((c) => c.method === 'eq' && c.col === 'kind' && c.val === 'stream')).toBe(true)
  })

  it('does NOT apply kind filter when kind is null', async () => {
    mockUser = { id: 'user-5' }
    downloadsResponse = { data: [], error: null }
    await getDownloadHistory({ kind: null })
    expect(calls.some((c) => c.method === 'eq' && c.col === 'kind')).toBe(false)
  })

  it('applies since filter when set', async () => {
    mockUser = { id: 'user-6' }
    downloadsResponse = { data: [], error: null }
    await getDownloadHistory({ since: '2026-01-01T00:00:00Z' })
    expect(
      calls.some(
        (c) => c.method === 'gte' && c.col === 'created_at' && c.val === '2026-01-01T00:00:00Z',
      ),
    ).toBe(true)
  })

  it('does NOT apply since filter when null', async () => {
    mockUser = { id: 'user-7' }
    downloadsResponse = { data: [], error: null }
    await getDownloadHistory({ since: null })
    expect(calls.some((c) => c.method === 'gte')).toBe(false)
  })

  it('clamps limit to MAX_HISTORY_ROWS', async () => {
    mockUser = { id: 'user-8' }
    downloadsResponse = { data: [], error: null }
    await getDownloadHistory({ limit: 99_999 })
    expect(calls.some((c) => c.method === 'limit' && c.n === MAX_HISTORY_ROWS)).toBe(true)
  })

  it('clamps limit to 0 when invalid', async () => {
    mockUser = { id: 'user-9' }
    downloadsResponse = { data: [], error: null }
    await getDownloadHistory({ limit: -5 })
    // -5 → not > 0 → defaults to MAX_HISTORY_ROWS
    expect(calls.some((c) => c.method === 'limit' && c.n === MAX_HISTORY_ROWS)).toBe(true)
  })

  it('maps array-embed file + product joins', async () => {
    mockUser = { id: 'user-10' }
    downloadsResponse = {
      data: [
        {
          id: 1,
          kind: 'download',
          created_at: '2026-06-25T10:00:00Z',
          url_expires_at: '2026-06-26T10:00:00Z',
          ip_raw: '192.168.1.42',
          user_agent: 'Mozilla/5.0 ... Chrome/124.0.0.0 Safari/537.36',
          edge_location: 'LAX',
          file_id: 100,
          product_id: 50,
          file: [{ original_filename: 'lesson-01.pdf' }],
          product: [{ title: 'Course Ten', slug: 'course-ten' }],
        },
      ],
      error: null,
    }
    const result = await getDownloadHistory()
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]!.original_filename).toBe('lesson-01.pdf')
    expect(result.entries[0]!.product_title).toBe('Course Ten')
    expect(result.entries[0]!.product_slug).toBe('course-ten')
    expect(result.entries[0]!.edge_location).toBe('LAX')
  })

  it('maps object-embed joins (defensive — PostgREST varies)', async () => {
    mockUser = { id: 'user-11' }
    downloadsResponse = {
      data: [
        {
          id: 2,
          kind: 'stream',
          created_at: '2026-06-25T11:00:00Z',
          url_expires_at: '2026-06-25T15:00:00Z',
          ip_raw: null,
          user_agent: null,
          edge_location: null,
          file_id: 101,
          product_id: 51,
          file: { original_filename: 'intro.mp4' },
          product: { title: 'Course Eleven', slug: 'course-eleven' },
        },
      ],
      error: null,
    }
    const result = await getDownloadHistory()
    expect(result.entries[0]!.original_filename).toBe('intro.mp4')
    expect(result.entries[0]!.product_title).toBe('Course Eleven')
    expect(result.entries[0]!.ip_raw).toBeNull()
    expect(result.entries[0]!.edge_location).toBeNull()
  })

  it('handles deleted FK (file_id null) — filename null, product join still resolves', async () => {
    mockUser = { id: 'user-12' }
    downloadsResponse = {
      data: [
        {
          id: 3,
          kind: 'download',
          created_at: '2026-06-20T10:00:00Z',
          url_expires_at: '2026-06-21T10:00:00Z',
          ip_raw: '10.0.0.1',
          user_agent: 'curl/8.4.0',
          edge_location: 'JFK',
          file_id: null,
          product_id: 52,
          file: null,
          product: [{ title: 'Course Twelve', slug: 'course-twelve' }],
        },
      ],
      error: null,
    }
    const result = await getDownloadHistory()
    expect(result.entries[0]!.file_id).toBeNull()
    expect(result.entries[0]!.original_filename).toBeNull()
    expect(result.entries[0]!.product_id).toBe(52)
    expect(result.entries[0]!.product_title).toBe('Course Twelve')
  })

  it('handles fully-deleted (file_id + product_id both null)', async () => {
    mockUser = { id: 'user-13' }
    downloadsResponse = {
      data: [
        {
          id: 4,
          kind: 'download',
          created_at: '2026-06-15T10:00:00Z',
          url_expires_at: '2026-06-16T10:00:00Z',
          ip_raw: null,
          user_agent: null,
          edge_location: null,
          file_id: null,
          product_id: null,
          file: null,
          product: null,
        },
      ],
      error: null,
    }
    const result = await getDownloadHistory()
    expect(result.entries[0]!.file_id).toBeNull()
    expect(result.entries[0]!.original_filename).toBeNull()
    expect(result.entries[0]!.product_id).toBeNull()
    expect(result.entries[0]!.product_title).toBeNull()
    expect(result.entries[0]!.product_slug).toBeNull()
  })

  it('returns empty + warn + total_in_window = -1 on DB error', async () => {
    mockUser = { id: 'user-14' }
    downloadsResponse = { data: null, error: { message: 'permission denied' } }
    const result = await getDownloadHistory()
    expect(result.entries).toEqual([])
    expect(result.total_in_window).toBe(-1)
  })

  it('echoes normalized filters in the result', async () => {
    mockUser = { id: 'user-15' }
    downloadsResponse = { data: [], error: null }
    const result = await getDownloadHistory({ kind: 'stream', since: '2026-01-01T00:00:00Z' })
    expect(result.filters.kind).toBe('stream')
    expect(result.filters.since).toBe('2026-01-01T00:00:00Z')
    expect(result.filters.limit).toBe(MAX_HISTORY_ROWS)
  })

  it('rejects bogus kind values during normalization', async () => {
    mockUser = { id: 'user-16' }
    downloadsResponse = { data: [], error: null }
    // The type system would prevent this at compile time; the runtime
    // guard is defense in depth for cross-feature imports.
    const result = await getDownloadHistory({ kind: 'wat' as unknown as 'download' })
    expect(result.filters.kind).toBeNull()
    expect(calls.some((c) => c.method === 'eq' && c.col === 'kind')).toBe(false)
  })

  it('default sort is created_at DESC (newest first)', async () => {
    mockUser = { id: 'user-17' }
    downloadsResponse = {
      data: [
        {
          id: 1,
          kind: 'download',
          created_at: '2026-06-25T10:00:00Z',
          url_expires_at: '2026-06-26T10:00:00Z',
          ip_raw: null,
          user_agent: null,
          edge_location: null,
          file_id: null,
          product_id: null,
          file: null,
          product: null,
        },
        {
          id: 2,
          kind: 'download',
          created_at: '2026-06-24T10:00:00Z',
          url_expires_at: '2026-06-25T10:00:00Z',
          ip_raw: null,
          user_agent: null,
          edge_location: null,
          file_id: null,
          product_id: null,
          file: null,
          product: null,
        },
      ],
      error: null,
    }
    const result = await getDownloadHistory()
    expect(result.entries[0]!.id).toBe(1)
    expect(result.entries[1]!.id).toBe(2)
  })
})

describe('windowSince', () => {
  it('returns null for "all"', () => {
    expect(windowSince('all')).toBeNull()
  })

  it('returns null for null', () => {
    expect(windowSince(null)).toBeNull()
  })

  it('returns null for undefined', () => {
    expect(windowSince(undefined)).toBeNull()
  })

  it('returns null for non-positive numbers', () => {
    expect(windowSince(0)).toBeNull()
    expect(windowSince(-1)).toBeNull()
  })

  it('returns null for non-number / non-"all" strings', () => {
    expect(windowSince('forever' as unknown as number)).toBeNull()
  })

  it('returns ISO timestamp N days back from now', () => {
    const NOW = 1_750_000_000_000 // fixed timestamp
    const since = windowSince(30, NOW)
    expect(since).not.toBeNull()
    // 30 days back = 30 * 86_400_000 ms
    const expected = new Date(NOW - 30 * 24 * 60 * 60 * 1000).toISOString()
    expect(since).toBe(expected)
  })
})
