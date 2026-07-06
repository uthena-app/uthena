// getPartnerStorageUsage.test.ts — unit tests for the P7.10
// `getPartnerStorageUsage` query.
//
// Covers:
//   - **Input validation (Zod)**: invalid partnerId (non-numeric,
//     negative, zero, NaN, empty, fractional) → null without
//     hitting the DB.
//   - **Auth gating**: no session user → null + no DB calls;
//     non-admin role → null + no DB calls.
//   - **Happy path**: partner with products + files → correct
//     total + per-product breakdown + capped flag.
//   - **Empty partner**: no products → zero usage (not null).
//   - **Partner with products but no files**: products count > 0
//     but file_count = 0, by_product is empty after filter.
//   - **Products read error**: fail-soft to zero usage + warn log.
//   - **Files read error**: fail-soft to zero usage + warn log.
//   - **Sort**: by_product sorted by size desc.
//   - **Capped**: more products than limit → by_product length =
//     limit + capped = true.
//   - **Defensive size coercion**: null size_bytes → treated as 0.
//   - **PII safety**: products select NEVER contains
//     long_description / partner payout columns; files select
//     NEVER contains storage_path / bunny_video_id /
//     hls_manifest_url / checksum_sha256.
//   - **Query shape**: products uses `eq('partner_id', ...)`;
//     files uses `.in('product_id', [list])`.
//
// Pattern follows `getAdminPartnerPayouts.test.ts` — per-chain
// queue mock so the test can enqueue results for each chain in
// order without race conditions.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ----- Mocks ---------------------------------------------------------------

type ServerCall =
  | { method: 'from'; table: string; chainIndex: number }
  | { method: 'select'; payload: unknown; chainIndex: number }
  | { method: 'eq'; col: string; val: unknown; chainIndex: number }
  | { method: 'in'; col: string; val: unknown; chainIndex: number }
  | { method: 'order'; col: string; ascending?: boolean | undefined; chainIndex: number }

const serverCalls: ServerCall[] = []
const chainQueues = new Map<number, Array<{ data: unknown; error: unknown }>>()
let chainCounter = 0

function makeServerChain() {
  const chainIndex = chainCounter++
  const queue = chainQueues.get(chainIndex) ?? []
  let resolved = false
  const chain: any = {
    select(payload: unknown) {
      serverCalls.push({ method: 'select', payload, chainIndex })
      return chain
    },
    eq(col: string, val: unknown) {
      serverCalls.push({ method: 'eq', col, val, chainIndex })
      return chain
    },
    in(col: string, val: unknown) {
      serverCalls.push({ method: 'in', col, val, chainIndex })
      return chain
    },
    order(col: string, opts?: { ascending?: boolean }) {
      const ascending = opts && 'ascending' in opts ? opts.ascending : undefined
      serverCalls.push({ method: 'order', col, ascending, chainIndex })
      return chain
    },
    then(onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
      if (!resolved) {
        resolved = true
        const queued = queue.shift() ?? { data: null, error: null }
        const value = {
          data: queued.data,
          error: queued.error,
          count: (queued as { count?: number }).count ?? null,
        }
        return Promise.resolve(value).then(onFulfilled, onRejected)
      }
      return Promise.resolve({ data: null, error: null }).then(onFulfilled, onRejected)
    },
  }
  return chain
}

const fakeServiceSupabase = {
  from: vi.fn((table: string) => {
    const chainIndex = chainCounter
    if (!chainQueues.has(chainIndex)) {
      chainQueues.set(chainIndex, [])
    }
    serverCalls.push({ method: 'from', table, chainIndex })
    return makeServerChain()
  }),
}

function enqueue(chainIndex: number, data: unknown, error: unknown = null): void {
  let queue = chainQueues.get(chainIndex)
  if (!queue) {
    queue = []
    chainQueues.set(chainIndex, queue)
  }
  queue.push({ data, error })
}

function resetMocks(): void {
  serverCalls.length = 0
  chainQueues.clear()
  chainCounter = 0
  fakeServiceSupabase.from.mockClear()
}

vi.mock('@foundations/data/supabase', () => ({
  getServiceSupabase: vi.fn(() => fakeServiceSupabase),
}))

// ----- Logger mock ---------------------------------------------------------

const logCalls: Array<{
  level: 'info' | 'warn' | 'error' | 'debug'
  payload: Record<string, unknown>
  msg?: string | undefined
}> = []

const fakeLogger = vi.hoisted(() => ({
  info: (payload: Record<string, unknown>, msg?: string) =>
    logCalls.push({ level: 'info', payload, msg }),
  warn: (payload: Record<string, unknown>, msg?: string) =>
    logCalls.push({ level: 'warn', payload, msg }),
  error: (payload: Record<string, unknown>, msg?: string) =>
    logCalls.push({ level: 'error', payload, msg }),
  debug: (payload: Record<string, unknown>, msg?: string) =>
    logCalls.push({ level: 'debug', payload, msg }),
}))

vi.mock('@foundations/log/pino', () => ({
  loggerFor: vi.fn(() => fakeLogger),
}))

// ----- Auth mocks ----------------------------------------------------------

const sessionUser: { id: string } | null = { id: '00000000-0000-0000-0000-000000000001' }

vi.mock('@foundations/auth/guards', () => ({
  getSessionUser: vi.fn(async () => sessionUser),
  requireRole: vi.fn(async () => undefined),
}))

// ----- Tests ---------------------------------------------------------------

import { getPartnerStorageUsage } from './getPartnerStorageUsage'

beforeEach(() => {
  resetMocks()
  logCalls.length = 0
})

afterEach(() => {
  resetMocks()
})

describe('getPartnerStorageUsage', () => {
  describe('input validation', () => {
    it('returns null for non-numeric partnerId (no DB call)', async () => {
      const result = await getPartnerStorageUsage({ partnerId: 'abc' })
      expect(result).toBeNull()
      expect(fakeServiceSupabase.from).not.toHaveBeenCalled()
    })

    it('returns null for negative partnerId', async () => {
      const result = await getPartnerStorageUsage({ partnerId: -1 })
      expect(result).toBeNull()
    })

    it('returns null for zero partnerId', async () => {
      const result = await getPartnerStorageUsage({ partnerId: 0 })
      expect(result).toBeNull()
    })

    it('returns null for empty string partnerId', async () => {
      const result = await getPartnerStorageUsage({ partnerId: '' })
      expect(result).toBeNull()
    })

    it('coerces numeric string partnerId to number', async () => {
      enqueue(0, [{ id: 1, slug: 'a', title: 'A', status: 'published' }], null)
      const result = await getPartnerStorageUsage({ partnerId: '42' })
      expect(result).not.toBeNull()
      expect(result!.partner_id).toBe(42)
    })

    it('caps productLimit at 200', async () => {
      const { GetPartnerStorageUsageOptionsSchema } = await import('./getPartnerStorageUsage')
      const parsed = GetPartnerStorageUsageOptionsSchema.safeParse({
        partnerId: 1,
        productLimit: 9999,
      })
      expect(parsed.success).toBe(false)
    })

    it('rejects productLimit < 1', async () => {
      const { GetPartnerStorageUsageOptionsSchema } = await import('./getPartnerStorageUsage')
      const parsed = GetPartnerStorageUsageOptionsSchema.safeParse({
        partnerId: 1,
        productLimit: 0,
      })
      expect(parsed.success).toBe(false)
    })

    it('defaults productLimit to 10', async () => {
      enqueue(0, [], null)
      const result = await getPartnerStorageUsage({ partnerId: 1 })
      expect(result).not.toBeNull()
      expect(result!.by_product.length).toBe(0)
    })
  })

  describe('auth gating', () => {
    it('returns null when getSessionUser returns null', async () => {
      const guards = await import('@foundations/auth/guards')
      ;(guards.getSessionUser as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null)
      const result = await getPartnerStorageUsage({ partnerId: 1 })
      expect(result).toBeNull()
      expect(fakeServiceSupabase.from).not.toHaveBeenCalled()
    })

    it('returns null when requireRole throws', async () => {
      const guards = await import('@foundations/auth/guards')
      ;(guards.requireRole as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('forbidden'),
      )
      const result = await getPartnerStorageUsage({ partnerId: 1 })
      expect(result).toBeNull()
      expect(fakeServiceSupabase.from).not.toHaveBeenCalled()
    })
  })

  describe('happy path', () => {
    it('returns total + per-product breakdown for a partner with files', async () => {
      // chain 0: products read
      enqueue(0, [
        { id: 1, slug: 'course-a', title: 'Course A', status: 'published' },
        { id: 2, slug: 'course-b', title: 'Course B', status: 'draft' },
        { id: 3, slug: 'course-c', title: 'Course C', status: 'published' },
      ])
      // chain 1: files read
      enqueue(1, [
        { product_id: 1, size_bytes: 100 },
        { product_id: 1, size_bytes: 200 },
        { product_id: 2, size_bytes: 500 },
        { product_id: 3, size_bytes: 1000 },
        { product_id: 3, size_bytes: 2000 },
        { product_id: 3, size_bytes: 3000 },
      ])

      const result = await getPartnerStorageUsage({ partnerId: 42 })
      expect(result).not.toBeNull()
      expect(result!.partner_id).toBe(42)
      expect(result!.total_bytes).toBe(6800)
      expect(result!.file_count).toBe(6)
      expect(result!.product_count).toBe(3)
      // Sorted desc by size_bytes
      expect(result!.by_product.map((p) => p.product_id)).toEqual([3, 2, 1])
      expect(result!.by_product[0]).toEqual({
        product_id: 3,
        product_slug: 'course-c',
        product_title: 'Course C',
        product_status: 'published',
        size_bytes: 6000,
        file_count: 3,
      })
      expect(result!.capped).toBe(false)
    })

    it('returns zero usage for a partner with no products', async () => {
      enqueue(0, [], null)
      // No chain 1 — files read is never made
      const result = await getPartnerStorageUsage({ partnerId: 99 })
      expect(result).not.toBeNull()
      expect(result!.total_bytes).toBe(0)
      expect(result!.file_count).toBe(0)
      expect(result!.product_count).toBe(0)
      expect(result!.by_product).toEqual([])
      expect(result!.capped).toBe(false)
      // Confirm we did NOT make a files read
      expect(serverCalls.filter((c) => c.method === 'from' && c.table === 'product_files')).toHaveLength(0)
    })

    it('returns zero usage for a partner with products but no files', async () => {
      enqueue(0, [
        { id: 1, slug: 'a', title: 'A', status: 'draft' },
      ])
      enqueue(1, [])
      const result = await getPartnerStorageUsage({ partnerId: 7 })
      expect(result).not.toBeNull()
      expect(result!.product_count).toBe(0)
      expect(result!.total_bytes).toBe(0)
      expect(result!.file_count).toBe(0)
      expect(result!.by_product).toEqual([])
    })

    it('filters out products with size_bytes=0 (empty filter)', async () => {
      enqueue(0, [
        { id: 1, slug: 'a', title: 'A', status: 'draft' },
        { id: 2, slug: 'b', title: 'B', status: 'draft' },
      ])
      enqueue(1, [
        { product_id: 1, size_bytes: 100 },
        // product_id 2 has no files
      ])
      const result = await getPartnerStorageUsage({ partnerId: 5 })
      expect(result!.by_product.length).toBe(1)
      expect(result!.by_product[0]!.product_id).toBe(1)
      expect(result!.product_count).toBe(1)
    })
  })

  describe('capped', () => {
    it('caps by_product at productLimit and sets capped=true', async () => {
      const products = Array.from({ length: 5 }, (_, i) => ({
        id: i + 1,
        slug: `p${i + 1}`,
        title: `Product ${i + 1}`,
        status: 'published' as const,
      }))
      const files = products.map((p, i) => ({
        product_id: p.id,
        size_bytes: (i + 1) * 1000, // ascending sizes
      }))
      enqueue(0, products)
      enqueue(1, files)
      const result = await getPartnerStorageUsage({ partnerId: 1, productLimit: 2 })
      expect(result!.by_product.length).toBe(2)
      expect(result!.capped).toBe(true)
      // Top 2 are the largest (product_id 5 with 5000, then 4 with 4000)
      expect(result!.by_product.map((p) => p.product_id)).toEqual([5, 4])
    })

    it('does not cap when products <= productLimit', async () => {
      enqueue(0, [
        { id: 1, slug: 'a', title: 'A', status: 'published' },
      ])
      enqueue(1, [{ product_id: 1, size_bytes: 100 }])
      const result = await getPartnerStorageUsage({ partnerId: 1, productLimit: 10 })
      expect(result!.by_product.length).toBe(1)
      expect(result!.capped).toBe(false)
    })
  })

  describe('defensive coercion', () => {
    it('treats null size_bytes as 0', async () => {
      enqueue(0, [
        { id: 1, slug: 'a', title: 'A', status: 'published' },
        { id: 2, slug: 'b', title: 'B', status: 'published' },
      ])
      enqueue(1, [
        { product_id: 1, size_bytes: 100 },
        { product_id: 2, size_bytes: null },
      ])
      const result = await getPartnerStorageUsage({ partnerId: 1 })
      expect(result!.total_bytes).toBe(100)
      expect(result!.by_product.length).toBe(1)
      expect(result!.by_product[0]!.product_id).toBe(1)
    })

    it('treats missing size_bytes as 0', async () => {
      enqueue(0, [
        { id: 1, slug: 'a', title: 'A', status: 'published' },
      ])
      enqueue(1, [
        { product_id: 1 } as { product_id: number; size_bytes: number | null },
      ])
      const result = await getPartnerStorageUsage({ partnerId: 1 })
      expect(result!.total_bytes).toBe(0)
      expect(result!.by_product).toEqual([])
    })
  })

  describe('fail-soft', () => {
    it('returns zero usage when products read errors', async () => {
      enqueue(0, null, { message: 'connection refused' })
      const result = await getPartnerStorageUsage({ partnerId: 1 })
      expect(result).not.toBeNull()
      expect(result!.total_bytes).toBe(0)
      expect(result!.by_product).toEqual([])
      const warnCall = logCalls.find(
        (c) => c.level === 'warn' && c.payload.code === 'partner_storage_products_read_failed',
      )
      expect(warnCall).toBeDefined()
    })

    it('returns zero usage when files read errors', async () => {
      enqueue(0, [{ id: 1, slug: 'a', title: 'A', status: 'published' }])
      enqueue(1, null, { message: 'timeout' })
      const result = await getPartnerStorageUsage({ partnerId: 1 })
      expect(result).not.toBeNull()
      expect(result!.total_bytes).toBe(0)
      const warnCall = logCalls.find(
        (c) => c.level === 'warn' && c.payload.code === 'partner_storage_files_read_failed',
      )
      expect(warnCall).toBeDefined()
    })
  })

  describe('query shape', () => {
    it('products read filters by partner_id and orders by id asc', async () => {
      enqueue(0, [])
      await getPartnerStorageUsage({ partnerId: 42 })
      const productsCall = serverCalls.find(
        (c) => c.method === 'from' && c.table === 'products',
      )
      expect(productsCall).toBeDefined()
      const eqCall = serverCalls.find(
        (c) => c.method === 'eq' && c.col === 'partner_id' && c.val === 42,
      )
      expect(eqCall).toBeDefined()
      const orderCall = serverCalls.find(
        (c) => c.method === 'order' && c.col === 'id' && c.ascending === true,
      )
      expect(orderCall).toBeDefined()
    })

    it('files read uses .in(product_id, [...]) with the partner product ids', async () => {
      enqueue(0, [
        { id: 10, slug: 'a', title: 'A', status: 'published' },
        { id: 20, slug: 'b', title: 'B', status: 'published' },
      ])
      enqueue(1, [])
      await getPartnerStorageUsage({ partnerId: 1 })
      const inCall = serverCalls.find(
        (c): c is { method: 'in'; col: string; val: unknown; chainIndex: number } =>
          c.method === 'in' && c.col === 'product_id',
      )
      expect(inCall).toBeDefined()
      expect(inCall!.val).toEqual([10, 20])
    })
  })

  describe('PII safety', () => {
    it('products select is minimal (id, slug, title, status only)', async () => {
      enqueue(0, [])
      await getPartnerStorageUsage({ partnerId: 1 })
      const selectCallsForChain0 = serverCalls.filter(
        (c): c is { method: 'select'; payload: unknown; chainIndex: number } =>
          c.method === 'select' && c.chainIndex === 0,
      )
      expect(selectCallsForChain0.length).toBeGreaterThan(0)
      const payload = String(selectCallsForChain0[0]!.payload)
      expect(payload).toContain('id')
      expect(payload).toContain('slug')
      expect(payload).toContain('title')
      expect(payload).toContain('status')
      // PII / heavy columns that must NOT cross the wire
      expect(payload).not.toContain('long_description')
      expect(payload).not.toContain('description')
      expect(payload).not.toContain('partner_id')
      expect(payload).not.toContain('search_vector')
    })

    it('files select is minimal (product_id, size_bytes only)', async () => {
      enqueue(0, [{ id: 1, slug: 'a', title: 'A', status: 'published' }])
      enqueue(1, [])
      await getPartnerStorageUsage({ partnerId: 1 })
      const selectCallsForChain1 = serverCalls.filter(
        (c): c is { method: 'select'; payload: unknown; chainIndex: number } =>
          c.method === 'select' && c.chainIndex === 1,
      )
      expect(selectCallsForChain1.length).toBeGreaterThan(0)
      const payload = String(selectCallsForChain1[0]!.payload)
      expect(payload).toContain('product_id')
      expect(payload).toContain('size_bytes')
      // Sensitive columns that must NOT cross the wire
      expect(payload).not.toContain('storage_path')
      expect(payload).not.toContain('bunny_video_id')
      expect(payload).not.toContain('hls_manifest_url')
      expect(payload).not.toContain('checksum_sha256')
      expect(payload).not.toContain('original_filename')
    })

    it('log payloads never contain raw partner_id or user_id', async () => {
      enqueue(0, null, { message: 'fail' })
      await getPartnerStorageUsage({ partnerId: 99999 })
      // The log payload should use a hash, not the raw partner id
      const warnCall = logCalls.find(
        (c) => c.level === 'warn' && c.payload.code === 'partner_storage_products_read_failed',
      )
      expect(warnCall).toBeDefined()
      const payloadStr = JSON.stringify(warnCall!.payload)
      expect(payloadStr).not.toContain('99999')
      expect(payloadStr).toContain('partner_hash')
    })
  })
})