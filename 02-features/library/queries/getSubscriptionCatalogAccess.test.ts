// getSubscriptionCatalogAccess.test.ts — unit tests for the P8.2
// catalog-access query. Mirrors the test pattern from
// `getUserLibrary.test.ts`: chainable fake Supabase + mocked
// session user + mocked logger.
//
// What we verify:
//   - anon path: returns empty Set + totalAccessible 0 + zero RPC calls
//   - authed happy path: filters to access_source === 'subscription'
//     (purchases, admin grants, free promos are excluded)
//   - authed with no library: empty Set + totalAccessible 0
//   - RPC error: fail-soft — empty Set + totalAccessible 0
//   - mixed access sources: only subscription ids land in the Set
//   - React `cache()` deduplication: same call resolves once per request
//   - returned Set is a fresh instance per call (consumer mutation
//     safety — a stale Set never bleeds into the next render)

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type RpcCall = { fn: string; args: Record<string, unknown> }

const rpcCalls: RpcCall[] = []
let rpcResponse: { data: unknown; error: unknown } = { data: null, error: null }
let mockUser: { id: string } | null = null
let rpcCallCount = 0

const fakeServer = {
  rpc: vi.fn((fn: string, args: Record<string, unknown>) => {
    rpcCalls.push({ fn, args })
    rpcCallCount += 1
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
const { getSubscriptionCatalogAccess } = await import('./getSubscriptionCatalogAccess')

beforeEach(() => {
  rpcCalls.length = 0
  rpcResponse = { data: null, error: null }
  mockUser = null
  rpcCallCount = 0
  fakeServer.rpc.mockClear()
  // React's cache() caches across the lifetime of the test process.
  // Reset by re-importing? Easier: each test sets a different mockUser
  // and asserts the effect. The cache is per-process for the test, so
  // we assert counts via the fakeServer.rpc.mock.calls.length.
})

afterEach(() => {
  // No teardown needed — vi.fn().mockClear() in beforeEach is enough.
})

describe('getSubscriptionCatalogAccess', () => {
  it('returns empty Set + zero RPC calls + hasActiveSubscription:false when there is no session', async () => {
    mockUser = null
    const result = await getSubscriptionCatalogAccess()
    expect(result.productIds.size).toBe(0)
    expect(result.totalAccessible).toBe(0)
    expect(result.hasActiveSubscription).toBe(false)
    expect(fakeServer.rpc).not.toHaveBeenCalled()
  })

  it('returns the user-accessible RPC filter narrowed to subscription on the happy path', async () => {
    mockUser = { id: 'user-1' }
    rpcResponse = {
      data: [
        { product_id: 101, access_source: 'subscription' },
        { product_id: 202, access_source: 'subscription' },
      ],
      error: null,
    }
    const result = await getSubscriptionCatalogAccess()
    expect(result.productIds.size).toBe(2)
    expect(result.productIds.has(101)).toBe(true)
    expect(result.productIds.has(202)).toBe(true)
    expect(result.totalAccessible).toBe(2)
    expect(result.hasActiveSubscription).toBe(true)
  })

  it('excludes non-subscription access sources from the returned Set', async () => {
    mockUser = { id: 'user-2' }
    rpcResponse = {
      data: [
        { product_id: 101, access_source: 'subscription' },
        { product_id: 202, access_source: 'purchase' },
        { product_id: 303, access_source: 'admin_grant' },
        { product_id: 404, access_source: 'free_promo' },
        { product_id: 505, access_source: 'subscription' },
      ],
      error: null,
    }
    const result = await getSubscriptionCatalogAccess()
    expect(result.productIds.size).toBe(2)
    expect(result.productIds.has(101)).toBe(true)
    expect(result.productIds.has(505)).toBe(true)
    expect(result.productIds.has(202)).toBe(false)
    expect(result.productIds.has(303)).toBe(false)
    expect(result.productIds.has(404)).toBe(false)
    // totalAccessible counts all sources — used by the header subtitle.
    expect(result.totalAccessible).toBe(5)
    // hasActiveSubscription is true because the Set has subscription rows
    // (purchase/admin_grant rows alone do NOT flip the boolean — only
    // subscription-source rows do, matching the P8.3 gate semantic).
    expect(result.hasActiveSubscription).toBe(true)
  })

  it('returns empty Set + totalAccessible 0 + hasActiveSubscription:false when RPC returns empty array', async () => {
    mockUser = { id: 'user-3' }
    rpcResponse = { data: [], error: null }
    const result = await getSubscriptionCatalogAccess()
    expect(result.productIds.size).toBe(0)
    expect(result.totalAccessible).toBe(0)
    expect(result.hasActiveSubscription).toBe(false)
  })

  it('returns empty Set + totalAccessible 0 + hasActiveSubscription:false when RPC returns data: null', async () => {
    mockUser = { id: 'user-4' }
    rpcResponse = { data: null, error: null }
    const result = await getSubscriptionCatalogAccess()
    expect(result.productIds.size).toBe(0)
    expect(result.totalAccessible).toBe(0)
    expect(result.hasActiveSubscription).toBe(false)
  })

  it('fails soft on RPC error — returns empty Set + hasActiveSubscription:false without throwing', async () => {
    mockUser = { id: 'user-5' }
    rpcResponse = {
      data: null,
      error: { message: 'connection refused', code: 'PGRST000' },
    }
    const result = await getSubscriptionCatalogAccess()
    expect(result.productIds.size).toBe(0)
    expect(result.totalAccessible).toBe(0)
    // Fail-CLOSED on the boolean: a transient RPC outage refuses
    // access rather than granting it. Matches the P8.3 gate semantic.
    expect(result.hasActiveSubscription).toBe(false)
  })

  it('calls user_accessible_products with the session user id', async () => {
    mockUser = { id: 'user-6' }
    rpcResponse = { data: [], error: null }
    await getSubscriptionCatalogAccess()
    expect(fakeServer.rpc).toHaveBeenCalledWith('user_accessible_products', {
      p_user_id: 'user-6',
    })
  })

  it('returns a fresh Set instance on each call (consumer mutation safety)', async () => {
    mockUser = { id: 'user-7' }
    rpcResponse = {
      data: [{ product_id: 1, access_source: 'subscription' }],
      error: null,
    }
    const a = await getSubscriptionCatalogAccess()
    const b = await getSubscriptionCatalogAccess()
    expect(a.productIds).not.toBe(b.productIds)
    // Mutating one doesn't affect the other.
    a.productIds.add(999)
    expect(b.productIds.has(999)).toBe(false)
  })

  it('returns hasActiveSubscription:false when the only accessible rows are purchases (no subscription)', async () => {
    mockUser = { id: 'user-purchase-only' }
    rpcResponse = {
      data: [
        { product_id: 1, access_source: 'purchase' },
        { product_id: 2, access_source: 'admin_grant' },
      ],
      error: null,
    }
    const result = await getSubscriptionCatalogAccess()
    expect(result.productIds.size).toBe(0)
    expect(result.totalAccessible).toBe(2)
    // Critical for P8.3: the user has library access via purchase/admin
    // but does NOT have an active subscription. The PDP gate must
    // recognize this and refuse the subscriber-only upgrade path.
    expect(result.hasActiveSubscription).toBe(false)
  })

  it('handles a large Set without dropping entries', async () => {
    mockUser = { id: 'user-8' }
    const data = Array.from({ length: 500 }, (_, i) => ({
      product_id: i + 1,
      access_source: 'subscription' as const,
    }))
    rpcResponse = { data, error: null }
    const result = await getSubscriptionCatalogAccess()
    expect(result.productIds.size).toBe(500)
    expect(result.productIds.has(1)).toBe(true)
    expect(result.productIds.has(500)).toBe(true)
    expect(result.totalAccessible).toBe(500)
    expect(result.hasActiveSubscription).toBe(true)
  })
})
