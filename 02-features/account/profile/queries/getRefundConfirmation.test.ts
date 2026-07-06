// getRefundConfirmation.test.ts — unit tests for the server query
// that backs /account/orders/[id]/refund/sent. Uses the same
// chainable-fake-Supabase pattern as the rest of the queries test
// suite. Covers:
//
//   - Anon caller → null, no DB call (defense in depth; the page
//     also redirects via requireUser, but the query must hold the
//     same contract for any future direct caller).
//   - Happy path → returns the mapped shape.
//   - DB error → null + warn log (fail-soft — the page renders 404).
//   - Empty result (no row matching the predicates) → null.
//   - Defensive: status not in the typed enum → null + warn log.
//   - Query shape: asserts the explicit `id`, `order_id`,
//     `requested_by` predicates AND the PII-safe select payload
//     (no `notes`, no `stripe_refund_id`, no `approved_by`,
//     no `requested_by`).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Call =
  | { method: 'select'; payload: string }
  | { method: 'eq'; col: string; val: unknown }
  | { method: 'maybeSingle' }

const serverCalls: Call[] = []
let serverResponse: { data: unknown; error: unknown } = { data: null, error: null }
let mockUser: { id: string; email: string | null } | null = null

function makeChain() {
  const chain: any = {
    select(payload: string) {
      serverCalls.push({ method: 'select', payload })
      return chain
    },
    eq(col: string, val: unknown) {
      serverCalls.push({ method: 'eq', col, val })
      return chain
    },
    maybeSingle: vi.fn(async () => {
      serverCalls.push({ method: 'maybeSingle' })
      return serverResponse
    }),
  }
  return chain
}

const fakeServerSupabase = { from: vi.fn(() => makeChain()) }

vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: vi.fn(async () => fakeServerSupabase),
}))

vi.mock('@foundations/auth/guards', () => ({
  getSessionUser: vi.fn(async () => mockUser),
}))

const mockWarn = vi.fn()
vi.mock('@foundations/log/pino', () => ({
  loggerFor: () => ({
    info: vi.fn(),
    warn: (...args: unknown[]) => mockWarn(...args),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

const { getRefundConfirmation } = await import('./getRefundConfirmation')

beforeEach(() => {
  serverCalls.length = 0
  serverResponse = { data: null, error: null }
  mockUser = { id: 'user-1', email: 'user@example.com' }
  fakeServerSupabase.from.mockClear()
  mockWarn.mockClear()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('getRefundConfirmation — auth gating', () => {
  it('returns null for an anonymous caller without touching the DB', async () => {
    mockUser = null
    const res = await getRefundConfirmation({ orderId: 100, refundId: 7 })
    expect(res).toBeNull()
    expect(fakeServerSupabase.from).not.toHaveBeenCalled()
  })
})

describe('getRefundConfirmation — query shape (defense in depth)', () => {
  it('queries the refunds table with the explicit order_id + requested_by predicates and a PII-safe select', async () => {
    serverResponse = {
      data: { id: 7, status: 'pending', created_at: '2026-06-26T10:00:00Z' },
      error: null,
    }
    await getRefundConfirmation({ orderId: 100, refundId: 7 })
    expect(fakeServerSupabase.from).toHaveBeenCalledWith('refunds')
    expect(serverCalls).toEqual([
      { method: 'select', payload: 'id, status, created_at' },
      { method: 'eq', col: 'id', val: 7 },
      { method: 'eq', col: 'order_id', val: 100 },
      { method: 'eq', col: 'requested_by', val: 'user-1' },
      { method: 'maybeSingle' },
    ])
    // PII safety — the select payload must NEVER include columns that
    // could surface user-supplied or admin-internal data on a public
    // confirmation page.
    const select = serverCalls.find((c) => c.method === 'select') as
      | { method: 'select'; payload: string }
      | undefined
    expect(select).toBeDefined()
    expect(select!.payload).not.toContain('notes')
    expect(select!.payload).not.toContain('stripe_refund_id')
    expect(select!.payload).not.toContain('approved_by')
    expect(select!.payload).not.toContain('requested_by')
  })
})

describe('getRefundConfirmation — happy path', () => {
  it('returns the mapped RefundConfirmation shape', async () => {
    serverResponse = {
      data: { id: 7, status: 'pending', created_at: '2026-06-26T10:00:00Z' },
      error: null,
    }
    const res = await getRefundConfirmation({ orderId: 100, refundId: 7 })
    expect(res).toEqual({
      id: 7,
      status: 'pending',
      created_at: '2026-06-26T10:00:00Z',
    })
  })

  it('returns succeeded / failed / canceled statuses intact', async () => {
    for (const status of ['succeeded', 'failed', 'canceled'] as const) {
      serverCalls.length = 0
      serverResponse = {
        data: { id: 8, status, created_at: '2026-06-26T11:00:00Z' },
        error: null,
      }
      const res = await getRefundConfirmation({ orderId: 101, refundId: 8 })
      expect(res).toEqual({ id: 8, status, created_at: '2026-06-26T11:00:00Z' })
    }
  })
})

describe('getRefundConfirmation — empty + error paths', () => {
  it('returns null when no row matches (refundId wrong or order mismatch)', async () => {
    serverResponse = { data: null, error: null }
    const res = await getRefundConfirmation({ orderId: 100, refundId: 9999 })
    expect(res).toBeNull()
  })

  it('returns null + warn log on DB error (fail-soft — page renders 404)', async () => {
    serverResponse = { data: null, error: { message: 'connection reset' } }
    const res = await getRefundConfirmation({ orderId: 100, refundId: 7 })
    expect(res).toBeNull()
    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'refund_confirm_read_failed' }),
      'refund confirmation read failed',
    )
  })
})

describe('getRefundConfirmation — defensive status coercion', () => {
  it('returns null + warn log when the status is not in the typed enum', async () => {
    // A future enum extension or a tampered row could surface a value
    // the page doesn't know how to render. Fail closed.
    serverResponse = {
      data: { id: 9, status: 'in_progress', created_at: '2026-06-26T12:00:00Z' },
      error: null,
    }
    const res = await getRefundConfirmation({ orderId: 100, refundId: 9 })
    expect(res).toBeNull()
    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'refund_confirm_unexpected_status' }),
      'refund confirmation row has unexpected status',
    )
  })
})
