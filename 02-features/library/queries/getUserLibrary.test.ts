// getUserLibrary.test.ts — unit tests for the P0.7 / P5.8 / P7.1
// library accessor. Uses a chainable fake Supabase client + a mocked
// getSessionUser. Verifies:
//   - anon path returns [] without touching the DB
//   - happy path returns the RPC rows cast to AccessibleProduct[]
//   - error path returns [] + warn (fail-soft — the /library page
//     must still render even when the access RPC is broken)
//   - the RPC is called with the session user id (not anything else)

import { beforeEach, describe, expect, it, vi } from 'vitest'

type RpcCall = { fn: string; args: Record<string, unknown> }
type CallRecord = { method: 'rpc'; payload: RpcCall }

const rpcCalls: CallRecord[] = []
let rpcResponse: { data: unknown; error: unknown } = { data: null, error: null }
let mockUser: { id: string; display_name?: string } | null = null

const fakeServer = {
  rpc: vi.fn((fn: string, args: Record<string, unknown>) => {
    rpcCalls.push({ method: 'rpc', payload: { fn, args } })
    return Promise.resolve(rpcResponse)
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
const { getUserLibrary } = await import('./getUserLibrary')

beforeEach(() => {
  rpcCalls.length = 0
  rpcResponse = { data: null, error: null }
  mockUser = null
  fakeServer.rpc.mockClear()
})

describe('getUserLibrary', () => {
  it('returns [] without touching the DB when there is no session', async () => {
    mockUser = null
    const result = await getUserLibrary()
    expect(result).toEqual([])
    expect(fakeServer.rpc).not.toHaveBeenCalled()
  })

  it('returns the RPC rows cast to AccessibleProduct[] on the happy path', async () => {
    mockUser = { id: 'user-1' }
    rpcResponse = {
      data: [
        {
          product_id: 101,
          slug: 'course-a',
          title: 'Course A',
          thumbnail_url: null,
          kind: 'video_course',
          short_description: 'desc',
          total_lesson_count: 5,
          total_duration_seconds: 1800,
          partner_id: 1,
          partner_slug: 'alice',
          access_source: 'subscription',
          granted_at: '2026-06-20T00:00:00Z',
        },
        {
          product_id: 202,
          slug: 'course-b',
          title: 'Course B',
          thumbnail_url: 'https://cdn.example.com/b.jpg',
          kind: 'ebook',
          short_description: 'ebook desc',
          total_lesson_count: 0,
          total_duration_seconds: 0,
          partner_id: 2,
          partner_slug: 'bob',
          access_source: 'purchase',
          granted_at: '2026-06-21T00:00:00Z',
        },
      ],
      error: null,
    }
    const result = await getUserLibrary()
    expect(result).toHaveLength(2)
    expect(result[0]!.product_id).toBe(101)
    expect(result[0]!.access_source).toBe('subscription')
    expect(result[1]!.access_source).toBe('purchase')
  })

  it('returns [] when the RPC returns data: null', async () => {
    mockUser = { id: 'user-2' }
    rpcResponse = { data: null, error: null }
    const result = await getUserLibrary()
    expect(result).toEqual([])
  })

  it('returns [] on RPC error (fail-soft — the page still renders)', async () => {
    mockUser = { id: 'user-3' }
    rpcResponse = { data: null, error: { message: 'connection refused', code: 'PGRST000' } }
    const result = await getUserLibrary()
    expect(result).toEqual([])
  })

  it('calls user_accessible_products RPC with the session user id', async () => {
    mockUser = { id: 'user-4' }
    rpcResponse = { data: [], error: null }
    await getUserLibrary()
    expect(fakeServer.rpc).toHaveBeenCalledWith('user_accessible_products', { p_user_id: 'user-4' })
  })

  it('returns [] for an authenticated user with an empty access list', async () => {
    mockUser = { id: 'user-5' }
    rpcResponse = { data: [], error: null }
    const result = await getUserLibrary()
    expect(result).toEqual([])
  })
})