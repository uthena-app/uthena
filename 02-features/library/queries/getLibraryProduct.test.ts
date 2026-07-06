// getLibraryProduct.test.ts — Slice 1 of P7.2. The query composes 4
// reads (access RPC + product + files + active-stream count) and
// fail-softs to null on any error. Tests cover:
//   - Anon path → null, no DB calls.
//   - Slug not in accessible products → null, product/files not
//     fetched.
//   - Product unpublished or missing → null.
//   - Happy path → full payload shape (product + access + files +
//     activeStreams).
//   - Files hydration: last_accessed_at dedupes newest-first, FK-null
//     file_id skipped, fail-soft on audit-log read error.
//   - Partner join defensive mapping (array embed + object embed +
//     null fallback).
//   - Access error → null.

import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---- Mocks ----------------------------------------------------------------

const fromCalls: Array<{ table: string; payload: string; filters: Array<{ method: string; col?: string; val?: unknown }>; terminal: string }> = []
const rpcCalls: Array<{ fn: string; args: unknown }> = []

type Response = { data: unknown; error: unknown } | null

// A queue of "next from() call's response" + per-call response array.
// We use one `fromResponse` slot per call so the test can express
// "products returns X, product_files returns Y" inline.
const responsesByTable: Record<string, Response[]> = {}

let mockUser: { id: string; display_name: string; email: string } | null = null
let mockActiveStreams = 0

function makeChain(response: Response) {
  const chain: Record<string, unknown> = {}
  const terminal = () => Promise.resolve(response ?? { data: null, error: null })
  ;(chain as Record<string, unknown>).select = (payload: string) => {
    const last = fromCalls[fromCalls.length - 1]
    if (last && last.payload === '') last.payload = payload
    return chain
  }
  for (const m of ['eq', 'in', 'order', 'limit']) {
    ;(chain as Record<string, unknown>)[m] = (col: string, val: unknown) => {
      const last = fromCalls[fromCalls.length - 1]
      if (last) last.filters.push({ method: m, col, val })
      return chain
    }
  }
  ;(chain as Record<string, unknown>).maybeSingle = () => {
    const last = fromCalls[fromCalls.length - 1]
    if (last) last.terminal = 'maybeSingle'
    return terminal()
  }
  ;(chain as Record<string, unknown>).single = () => {
    const last = fromCalls[fromCalls.length - 1]
    if (last) last.terminal = 'single'
    return terminal()
  }
  ;(chain as Record<string, unknown>).then = (resolve: (v: unknown) => void) => {
    const last = fromCalls[fromCalls.length - 1]
    if (last) last.terminal = 'then'
    resolve(response ?? { data: null, error: null })
  }
  return chain
}

const fakeServer = {
  from: vi.fn((table: string) => {
    const queue = responsesByTable[table] ?? []
    const next = queue.shift() ?? null
    fromCalls.push({ table, payload: '', filters: [], terminal: '' })
    return makeChain(next)
  }),
  rpc: vi.fn((fn: string, args: unknown) => {
    rpcCalls.push({ fn, args })
    const queue = responsesByTable[`rpc:${fn}`] ?? []
    const next = queue.shift() ?? null
    fromCalls.push({ table: `rpc:${fn}`, payload: '', filters: [], terminal: '' })
    return makeChain(next)
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

vi.mock('./countActiveStreams', () => ({
  countActiveStreams: vi.fn(async () => mockActiveStreams),
}))

// Import AFTER mocks are registered.
const { getLibraryProduct } = await import('./getLibraryProduct')

// ---- Reset ----------------------------------------------------------------

beforeEach(() => {
  fromCalls.length = 0
  rpcCalls.length = 0
  for (const k of Object.keys(responsesByTable)) delete responsesByTable[k]
  fakeServer.from.mockClear()
  fakeServer.rpc.mockClear()
  mockUser = { id: 'user-1', display_name: 'Test User', email: 'test@example.com' }
  mockActiveStreams = 0
})

// ---- Fixture helpers ------------------------------------------------------

function stubAccess(overrides: Record<string, unknown> = {}) {
  responsesByTable['rpc:user_accessible_products'] = [
    {
      data: [
        {
          product_id: 1,
          slug: 'demo-course',
          access_source: 'purchase',
          granted_at: '2026-06-01T00:00:00Z',
          ...overrides,
        },
      ],
      error: null,
    },
  ]
}

function stubProduct(
  row: Record<string, unknown> | null = {
    id: 1,
    slug: 'demo-course',
    title: 'Demo Course',
    short_description: 'A demo course',
    kind: 'video_course',
    status: 'published',
    thumbnail_url: 'https://cdn.example.com/thumb.jpg',
    total_lesson_count: 12,
    total_duration_seconds: 3600,
    partner_id: 42,
    partner: {
      public_slug: 'acme-co',
      profile: { display_name: 'AC & Co.' },
    },
  },
) {
  responsesByTable['products'] = [{ data: row, error: null }]
}

function stubFiles(rows: Array<Record<string, unknown>> | null = []) {
  responsesByTable['product_files'] = [{ data: rows, error: null }]
}

function stubDownloads(rows: Array<{ file_id: number | null; created_at: string }> | null = []) {
  responsesByTable['file_downloads'] = [{ data: rows, error: null }]
}

// ---- Tests ----------------------------------------------------------------

describe('getLibraryProduct', () => {
  it('returns null for anon users without hitting the DB', async () => {
    mockUser = null
    const result = await getLibraryProduct('demo-course')
    expect(result).toBeNull()
    expect(fakeServer.from).not.toHaveBeenCalled()
    expect(fakeServer.rpc).not.toHaveBeenCalled()
  })

  it('returns null when the slug is not in the user\'s accessible set', async () => {
    stubAccess({ slug: 'other-course' })
    const result = await getLibraryProduct('demo-course')
    expect(result).toBeNull()
    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0]!.fn).toBe('user_accessible_products')
    // Product / files / downloads not fetched — only the rpc was called.
    expect(fakeServer.from).not.toHaveBeenCalled()
  })

  it('returns null when the access RPC errors', async () => {
    responsesByTable['rpc:user_accessible_products'] = [
      { data: null, error: { message: 'rpc boom' } },
    ]
    const result = await getLibraryProduct('demo-course')
    expect(result).toBeNull()
  })

  it('returns null when the product fetch errors', async () => {
    stubAccess()
    responsesByTable['products'] = [{ data: null, error: { message: 'product boom' } }]
    const result = await getLibraryProduct('demo-course')
    expect(result).toBeNull()
  })

  it('returns null when the product is missing', async () => {
    stubAccess()
    stubProduct(null)
    const result = await getLibraryProduct('demo-course')
    expect(result).toBeNull()
  })

  it('returns the full payload on the happy path', async () => {
    stubAccess({ access_source: 'subscription', granted_at: '2026-05-01T00:00:00Z' })
    stubProduct()
    stubFiles([
      {
        id: 100,
        product_id: 1,
        kind: 'transcript',
        original_filename: 'transcript.pdf',
        size_bytes: 102400,
        duration_seconds: null,
        hls_manifest_url: null,
        created_at: '2026-06-01T00:00:00Z',
        product: { title: 'Demo Course', slug: 'demo-course' },
      },
    ])
    stubDownloads([{ file_id: 100, created_at: '2026-06-20T10:00:00Z' }])
    mockActiveStreams = 2

    const result = await getLibraryProduct('demo-course')
    expect(result).not.toBeNull()
    expect(result!.product.id).toBe(1)
    expect(result!.product.title).toBe('Demo Course')
    expect(result!.product.partner_slug).toBe('acme-co')
    expect(result!.product.partner_display_name).toBe('AC & Co.')
    expect(result!.access.source).toBe('subscription')
    expect(result!.access.granted_at).toBe('2026-05-01T00:00:00Z')
    expect(result!.files).toHaveLength(1)
    expect(result!.files[0]!.last_accessed_at).toBe('2026-06-20T10:00:00Z')
    expect(result!.activeStreams).toBe(2)
  })

  it('passes p_user_id to the access RPC', async () => {
    stubAccess()
    stubProduct()
    stubFiles([])
    stubDownloads([])
    await getLibraryProduct('demo-course')
    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0]!.fn).toBe('user_accessible_products')
    expect(rpcCalls[0]!.args).toEqual({ p_user_id: 'user-1' })
  })

  it('product query includes status=published filter', async () => {
    stubAccess()
    stubProduct()
    stubFiles([])
    stubDownloads([])
    await getLibraryProduct('demo-course')
    const productCall = fromCalls.find((c) => c.table === 'products')
    expect(productCall).toBeDefined()
    expect(productCall!.filters).toContainEqual({ method: 'eq', col: 'slug', val: 'demo-course' })
    expect(productCall!.filters).toContainEqual({ method: 'eq', col: 'status', val: 'published' })
    expect(productCall!.terminal).toBe('maybeSingle')
  })

  it('product_files query is scoped to the product_id', async () => {
    stubAccess()
    stubProduct()
    stubFiles([])
    stubDownloads([])
    await getLibraryProduct('demo-course')
    const filesCall = fromCalls.find((c) => c.table === 'product_files')
    expect(filesCall).toBeDefined()
    expect(filesCall!.filters).toContainEqual({ method: 'eq', col: 'product_id', val: 1 })
    expect(filesCall!.filters).toContainEqual({ method: 'eq', col: 'scan_status', val: 'clean' })
    expect(filesCall!.filters).toContainEqual({ method: 'eq', col: 'encoding_status', val: 'ready' })
    expect(filesCall!.terminal).toBe('then')
  })

  it('file_downloads hydration dedupes newest-first per file_id', async () => {
    stubAccess()
    stubProduct()
    stubFiles([
      {
        id: 100,
        product_id: 1,
        kind: 'video',
        original_filename: 'lesson1.mp4',
        size_bytes: 1024,
        duration_seconds: 600,
        hls_manifest_url: 'https://cdn.example.com/manifest.m3u8',
        created_at: '2026-06-01T00:00:00Z',
        product: { title: 'Demo Course', slug: 'demo-course' },
      },
    ])
    // Supabase returns sorted by .order('created_at', { ascending: false }) —
    // newest-first. The first sighting per file_id wins (matches the
    // production SQL plan).
    stubDownloads([
      { file_id: 100, created_at: '2026-06-20T10:00:00Z' }, // newest — wins
      { file_id: 100, created_at: '2026-06-10T10:00:00Z' }, // older
    ])
    const result = await getLibraryProduct('demo-course')
    expect(result!.files[0]!.last_accessed_at).toBe('2026-06-20T10:00:00Z')
  })

  it('file_downloads hydration skips null file_id rows (FK orphan)', async () => {
    stubAccess()
    stubProduct()
    stubFiles([
      {
        id: 100,
        product_id: 1,
        kind: 'video',
        original_filename: 'lesson1.mp4',
        size_bytes: 1024,
        duration_seconds: 600,
        hls_manifest_url: null,
        created_at: '2026-06-01T00:00:00Z',
        product: { title: 'Demo Course', slug: 'demo-course' },
      },
    ])
    stubDownloads([
      { file_id: null, created_at: '2026-06-15T10:00:00Z' }, // FK-null — skipped
      { file_id: 100, created_at: '2026-06-20T10:00:00Z' },
    ])
    const result = await getLibraryProduct('demo-course')
    expect(result!.files[0]!.last_accessed_at).toBe('2026-06-20T10:00:00Z')
  })

  it('file_downloads hydration fails soft to null on read error', async () => {
    stubAccess()
    stubProduct()
    stubFiles([
      {
        id: 100,
        product_id: 1,
        kind: 'video',
        original_filename: 'lesson1.mp4',
        size_bytes: 1024,
        duration_seconds: 600,
        hls_manifest_url: null,
        created_at: '2026-06-01T00:00:00Z',
        product: { title: 'Demo Course', slug: 'demo-course' },
      },
    ])
    responsesByTable['file_downloads'] = [
      { data: null, error: { message: 'downloads boom' } },
    ]
    const result = await getLibraryProduct('demo-course')
    expect(result!.files[0]!.last_accessed_at).toBeNull()
  })

  it('skips the file_downloads hydration when no files are owned', async () => {
    stubAccess()
    stubProduct()
    stubFiles([])
    const result = await getLibraryProduct('demo-course')
    expect(result!.files).toEqual([])
    // Confirm no downloads query was issued (queue would not be
    // consumed but no assertion failure is desired).
    const downloadsCalls = fromCalls.filter((c) => c.table === 'file_downloads')
    expect(downloadsCalls).toHaveLength(0)
  })

  it('partner join handles array embed (PostgREST default)', async () => {
    stubAccess()
    stubProduct({
      id: 1,
      slug: 'demo-course',
      title: 'Demo Course',
      short_description: 'desc',
      kind: 'video_course',
      status: 'published',
      thumbnail_url: null,
      total_lesson_count: 0,
      total_duration_seconds: 0,
      partner_id: 42,
      partner: [
        {
          public_slug: 'array-partner',
          profile: [{ display_name: 'Array Partner' }],
        },
      ],
    })
    stubFiles([])
    stubDownloads([])
    const result = await getLibraryProduct('demo-course')
    expect(result!.product.partner_slug).toBe('array-partner')
    expect(result!.product.partner_display_name).toBe('Array Partner')
  })

  it('partner join handles null fallback', async () => {
    stubAccess()
    stubProduct({
      id: 1,
      slug: 'demo-course',
      title: 'Demo Course',
      short_description: 'desc',
      kind: 'video_course',
      status: 'published',
      thumbnail_url: null,
      total_lesson_count: 0,
      total_duration_seconds: 0,
      partner_id: 42,
      partner: null,
    })
    stubFiles([])
    stubDownloads([])
    const result = await getLibraryProduct('demo-course')
    expect(result!.product.partner_slug).toBeNull()
    expect(result!.product.partner_display_name).toBeNull()
  })

  it('handles product_files error fail-soft to empty list', async () => {
    stubAccess()
    stubProduct()
    responsesByTable['product_files'] = [
      { data: null, error: { message: 'files boom' } },
    ]
    const result = await getLibraryProduct('demo-course')
    expect(result!.files).toEqual([])
  })

  it('handles product_files as array embed (PostgREST default)', async () => {
    stubAccess()
    stubProduct()
    stubFiles([
      {
        id: 100,
        product_id: 1,
        kind: 'document',
        original_filename: 'notes.pdf',
        size_bytes: 2048,
        duration_seconds: null,
        hls_manifest_url: null,
        created_at: '2026-06-01T00:00:00Z',
        product: [{ title: 'Demo Course', slug: 'demo-course' }],
      },
    ])
    stubDownloads([])
    const result = await getLibraryProduct('demo-course')
    expect(result!.files[0]!.product_title).toBe('Demo Course')
  })

  it('handles product embed inside files row as null fallback', async () => {
    stubAccess()
    stubProduct()
    stubFiles([
      {
        id: 100,
        product_id: 1,
        kind: 'document',
        original_filename: 'orphan.pdf',
        size_bytes: 2048,
        duration_seconds: null,
        hls_manifest_url: null,
        created_at: '2026-06-01T00:00:00Z',
        product: null,
      },
    ])
    stubDownloads([])
    const result = await getLibraryProduct('demo-course')
    expect(result!.files[0]!.product_title).toBe('Unknown')
    expect(result!.files[0]!.product_slug).toBe('')
  })
})