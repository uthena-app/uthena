// getUserAccessibleFiles.test.ts — unit tests for the file vault
// accessor. Uses a chainable fake Supabase client + a mocked
// getSessionUser. Verifies:
//   - anon path returns [] without touching the DB
//   - empty access list → no second DB call → []
//   - happy path: rows are mapped (product join inlined to
//     product_title + product_slug; both array and object embed
//     shapes handled defensively)
//   - the second query filters by scan_status='clean' AND
//     encoding_status='ready' (v1 is strict — never serve
//     pending/infected files)
//   - error path returns [] + warn (fail-soft)
//   - P7.3: last_accessed_at is hydrated from file_downloads
//     (newest-first dedupe in JS), and falls back to null on
//     query error / no rows.
//
// This is the read that backs the file vault on /library. The
// mintDownloadUrlAction has its own access re-check (defense in
// depth), so a stale file row here doesn't grant access — it just
// means the user doesn't see the file in their vault.

import { beforeEach, describe, expect, it, vi } from 'vitest'

type CallRecord =
  | { method: 'rpc'; fn: string; args: Record<string, unknown> }
  | { method: 'from'; table: string }
  | { method: 'select'; payload: string }
  | { method: 'in'; col: string; vals: unknown[] }
  | { method: 'eq'; col: string; val: unknown }
  | { method: 'order'; col: string; ascending: boolean }

const calls: CallRecord[] = []
let rpcResponse: { data: unknown; error: unknown } = { data: null, error: null }
let filesResponse: { data: unknown; error: unknown } = { data: null, error: null }
let downloadsResponse: { data: unknown; error: unknown } = { data: null, error: null }
let mockUser: { id: string } | null = null

// Per-table response routing. The fake Supabase chain resolves to
// whichever response matches the table on the previous `.from(table)`
// call. We track the most-recent `.from` so the correct terminal
// response is served. Without this, every `.from(...)` would return
// the same response.
let lastFromTable: string | null = null

function makeChain(calls: CallRecord[], terminal: { data: unknown; error: unknown }) {
  const chain: any = {
    select(payload: string) {
      calls.push({ method: 'select', payload })
      return chain
    },
    in(col: string, vals: unknown[]) {
      calls.push({ method: 'in', col, vals })
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
    then(resolve: (v: unknown) => void) {
      resolve(terminal)
    },
  }
  return chain
}

function terminalFor(table: string): { data: unknown; error: unknown } {
  if (table === 'product_files') return filesResponse
  if (table === 'file_downloads') return downloadsResponse
  return { data: null, error: null }
}

const fakeServer = {
  rpc: vi.fn((fn: string, args: Record<string, unknown>) => {
    calls.push({ method: 'rpc', fn, args })
    return Promise.resolve(rpcResponse)
  }),
  from: vi.fn((table: string) => {
    calls.push({ method: 'from', table })
    lastFromTable = table
    return makeChain(calls, terminalFor(table))
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
const { getUserAccessibleFiles } = await import('./getUserAccessibleFiles')

beforeEach(() => {
  calls.length = 0
  rpcResponse = { data: null, error: null }
  filesResponse = { data: null, error: null }
  downloadsResponse = { data: null, error: null }
  mockUser = null
  lastFromTable = null
  fakeServer.rpc.mockClear()
  fakeServer.from.mockClear()
})

describe('getUserAccessibleFiles', () => {
  it('returns [] without touching the DB when there is no session', async () => {
    mockUser = null
    const result = await getUserAccessibleFiles()
    expect(result).toEqual([])
    expect(fakeServer.rpc).not.toHaveBeenCalled()
    expect(fakeServer.from).not.toHaveBeenCalled()
  })

  it('returns [] without querying files when the user owns nothing', async () => {
    mockUser = { id: 'user-1' }
    rpcResponse = { data: [], error: null }
    const result = await getUserAccessibleFiles()
    expect(result).toEqual([])
    // The product_files query MUST NOT run when there are no
    // owned products — that would leak the user's existence
    // timing-side-channel.
    expect(fakeServer.from).not.toHaveBeenCalled()
  })

  it('returns [] on access RPC error (fail-soft — vault stays empty)', async () => {
    mockUser = { id: 'user-2' }
    rpcResponse = { data: null, error: { message: 'permission denied', code: '42501' } }
    const result = await getUserAccessibleFiles()
    expect(result).toEqual([])
    // The files query MUST NOT run when the access RPC failed —
    // we don't have an owned-product allow-list to scope it by.
    expect(fakeServer.from).not.toHaveBeenCalled()
  })

  it('queries product_files scoped to owned product ids + clean + ready', async () => {
    mockUser = { id: 'user-3' }
    rpcResponse = {
      data: [
        { product_id: 10 },
        { product_id: 20 },
        { product_id: 30 },
      ],
      error: null,
    }
    filesResponse = { data: [], error: null }
    await getUserAccessibleFiles()
    expect(calls.some((c) => c.method === 'from' && c.table === 'product_files')).toBe(true)
    expect(calls.some((c) => c.method === 'in' && c.col === 'product_id' && JSON.stringify(c.vals) === '[10,20,30]')).toBe(true)
    expect(calls.some((c) => c.method === 'eq' && c.col === 'scan_status' && c.val === 'clean')).toBe(true)
    expect(calls.some((c) => c.method === 'eq' && c.col === 'encoding_status' && c.val === 'ready')).toBe(true)
    expect(calls.some((c) => c.method === 'order' && c.col === 'created_at' && c.ascending === false)).toBe(true)
  })

  it('maps happy-path rows (array-embed product join) to VaultFile', async () => {
    mockUser = { id: 'user-4' }
    rpcResponse = { data: [{ product_id: 10 }, { product_id: 20 }], error: null }
    filesResponse = {
      data: [
        {
          id: 100,
          product_id: 10,
          kind: 'transcript',
          original_filename: 'lesson-01.pdf',
          size_bytes: 2048,
          duration_seconds: null,
          hls_manifest_url: null,
          product: [{ title: 'Course Ten', slug: 'course-ten' }],
        },
      ],
      error: null,
    }
    const result = await getUserAccessibleFiles()
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      id: 100,
      product_id: 10,
      product_title: 'Course Ten',
      product_slug: 'course-ten',
      kind: 'transcript',
      original_filename: 'lesson-01.pdf',
      size_bytes: 2048,
      duration_seconds: null,
      hls_manifest_url: null,
      created_at: null,
      last_accessed_at: null,
    })
  })

  it('handles object-embed product join (defensive — PostgREST varies)', async () => {
    mockUser = { id: 'user-5' }
    rpcResponse = { data: [{ product_id: 10 }], error: null }
    filesResponse = {
      data: [
        {
          id: 101,
          product_id: 10,
          kind: 'slides',
          original_filename: 'slides.pdf',
          size_bytes: 4096,
          duration_seconds: 300,
          hls_manifest_url: null,
          product: { title: 'Course Ten', slug: 'course-ten' },
        },
      ],
      error: null,
    }
    const result = await getUserAccessibleFiles()
    expect(result[0]!.product_title).toBe('Course Ten')
    expect(result[0]!.product_slug).toBe('course-ten')
    expect(result[0]!.duration_seconds).toBe(300)
  })

  it('falls back to "Unknown" when the product join is null', async () => {
    mockUser = { id: 'user-6' }
    rpcResponse = { data: [{ product_id: 10 }], error: null }
    filesResponse = {
      data: [
        {
          id: 102,
          product_id: 10,
          kind: 'document',
          original_filename: 'doc.pdf',
          size_bytes: 1024,
          duration_seconds: null,
          hls_manifest_url: null,
          product: null,
        },
      ],
      error: null,
    }
    const result = await getUserAccessibleFiles()
    expect(result[0]!.product_title).toBe('Unknown')
    expect(result[0]!.product_slug).toBe('')
  })

  it('returns [] on files query error (fail-soft)', async () => {
    mockUser = { id: 'user-7' }
    rpcResponse = { data: [{ product_id: 10 }], error: null }
    filesResponse = { data: null, error: { message: 'connection refused' } }
    const result = await getUserAccessibleFiles()
    expect(result).toEqual([])
  })

  // -------------------------------------------------------------------------
  // P7.3 — last_accessed_at hydration
  // -------------------------------------------------------------------------

  it('returns last_accessed_at=null when no file_downloads rows match', async () => {
    mockUser = { id: 'user-8' }
    rpcResponse = { data: [{ product_id: 10 }], error: null }
    filesResponse = {
      data: [
        {
          id: 200,
          product_id: 10,
          kind: 'transcript',
          original_filename: 'lesson-01.pdf',
          size_bytes: 1024,
          duration_seconds: null,
          hls_manifest_url: null,
          product: [{ title: 'Course Ten', slug: 'course-ten' }],
        },
      ],
      error: null,
    }
    downloadsResponse = { data: [], error: null }
    const result = await getUserAccessibleFiles()
    expect(result[0]!.last_accessed_at).toBeNull()
  })

  it('hydrates last_accessed_at with the most-recent download per file', async () => {
    mockUser = { id: 'user-9' }
    rpcResponse = { data: [{ product_id: 10 }, { product_id: 20 }], error: null }
    filesResponse = {
      data: [
        {
          id: 201,
          product_id: 10,
          kind: 'transcript',
          original_filename: 'lesson-01.pdf',
          size_bytes: 1024,
          duration_seconds: null,
          hls_manifest_url: null,
          product: [{ title: 'Course Ten', slug: 'course-ten' }],
        },
        {
          id: 202,
          product_id: 20,
          kind: 'video',
          original_filename: 'intro.mp4',
          size_bytes: 50_000_000,
          duration_seconds: 600,
          hls_manifest_url: 'https://cdn.example/intro.m3u8',
          product: [{ title: 'Course Twenty', slug: 'course-twenty' }],
        },
      ],
      error: null,
    }
    // Source returns rows newest-first; we keep the first sighting
    // per file_id. The test fixture reflects that ordering.
    downloadsResponse = {
      data: [
        { file_id: 202, created_at: '2026-06-26T15:00:00Z' },
        { file_id: 202, created_at: '2026-06-20T10:00:00Z' },
        { file_id: 201, created_at: '2026-06-15T08:00:00Z' },
      ],
      error: null,
    }
    const result = await getUserAccessibleFiles()
    expect(result).toHaveLength(2)
    const r201 = result.find((r) => r.id === 201)!
    const r202 = result.find((r) => r.id === 202)!
    expect(r201.last_accessed_at).toBe('2026-06-15T08:00:00Z')
    expect(r202.last_accessed_at).toBe('2026-06-26T15:00:00Z')
  })

  it('queries file_downloads scoped to user_id + file_id IN (vault file ids)', async () => {
    mockUser = { id: 'user-10' }
    rpcResponse = { data: [{ product_id: 10 }], error: null }
    filesResponse = {
      data: [
        {
          id: 301,
          product_id: 10,
          kind: 'transcript',
          original_filename: 'a.pdf',
          size_bytes: 1024,
          duration_seconds: null,
          hls_manifest_url: null,
          product: [{ title: 'A', slug: 'a' }],
        },
        {
          id: 302,
          product_id: 10,
          kind: 'slides',
          original_filename: 'b.pdf',
          size_bytes: 2048,
          duration_seconds: null,
          hls_manifest_url: null,
          product: [{ title: 'A', slug: 'a' }],
        },
      ],
      error: null,
    }
    downloadsResponse = { data: [], error: null }
    await getUserAccessibleFiles()
    // We query file_downloads with .in('file_id', [301, 302]) and
    // .eq('user_id', 'user-10'). The order should be created_at desc
    // so the JS dedupe keeps the latest.
    const dlFromIndex = calls.findIndex((c) => c.method === 'from' && c.table === 'file_downloads')
    expect(dlFromIndex).toBeGreaterThan(-1)
    const dlCalls = calls.slice(dlFromIndex)
    expect(dlCalls.some((c) => c.method === 'in' && c.col === 'file_id' && JSON.stringify(c.vals) === '[301,302]')).toBe(true)
    expect(dlCalls.some((c) => c.method === 'eq' && c.col === 'user_id' && c.val === 'user-10')).toBe(true)
    expect(dlCalls.some((c) => c.method === 'order' && c.col === 'created_at' && c.ascending === false)).toBe(true)
    // PII safety: the file_downloads select MUST NOT pull ip_raw,
    // user_agent, range_start, range_end, bytes_served, edge_location,
    // url_expires_at. The minimal select is `file_id, created_at`.
    const dlSelect = dlCalls.find((c) => c.method === 'select')
    expect(dlSelect).toBeDefined()
    if (dlSelect && dlSelect.method === 'select') {
      expect(dlSelect.payload).toBe('file_id, created_at')
    }
  })

  it('skips the file_downloads query when there are no vault files', async () => {
    mockUser = { id: 'user-11' }
    rpcResponse = { data: [{ product_id: 10 }], error: null }
    // Empty files result means an empty vault — no downloads to look up.
    filesResponse = { data: [], error: null }
    downloadsResponse = { data: [], error: null }
    const result = await getUserAccessibleFiles()
    expect(result).toEqual([])
    // The file_downloads query MUST NOT run for an empty vault —
    // avoids a guaranteed-empty roundtrip + leaks no DB-call timing.
    expect(calls.some((c) => c.method === 'from' && c.table === 'file_downloads')).toBe(false)
  })

  it('falls back to last_accessed_at=null when the downloads query errors', async () => {
    mockUser = { id: 'user-12' }
    rpcResponse = { data: [{ product_id: 10 }], error: null }
    filesResponse = {
      data: [
        {
          id: 401,
          product_id: 10,
          kind: 'transcript',
          original_filename: 'lesson-01.pdf',
          size_bytes: 1024,
          duration_seconds: null,
          hls_manifest_url: null,
          product: [{ title: 'Course Ten', slug: 'course-ten' }],
        },
      ],
      error: null,
    }
    downloadsResponse = { data: null, error: { message: 'connection refused' } }
    const result = await getUserAccessibleFiles()
    // The vault MUST still render — fail-soft on the audit-log read.
    // "Never accessed" is the safe fallback (matches the empty case).
    expect(result).toHaveLength(1)
    expect(result[0]!.last_accessed_at).toBeNull()
  })

  it('skips file_downloads rows with null file_id (FK on delete set null)', async () => {
    mockUser = { id: 'user-13' }
    rpcResponse = { data: [{ product_id: 10 }], error: null }
    filesResponse = {
      data: [
        {
          id: 501,
          product_id: 10,
          kind: 'transcript',
          original_filename: 'lesson-01.pdf',
          size_bytes: 1024,
          duration_seconds: null,
          hls_manifest_url: null,
          product: [{ title: 'Course Ten', slug: 'course-ten' }],
        },
      ],
      error: null,
    }
    // The first row points at a deleted file (file_id=null) — the FK
    // is `on delete set null` in the migration. Skip it; it doesn't
    // correspond to any current vault row.
    downloadsResponse = {
      data: [
        { file_id: null, created_at: '2026-06-25T00:00:00Z' },
        { file_id: 501, created_at: '2026-06-15T00:00:00Z' },
      ],
      error: null,
    }
    const result = await getUserAccessibleFiles()
    expect(result[0]!.last_accessed_at).toBe('2026-06-15T00:00:00Z')
  })
})
