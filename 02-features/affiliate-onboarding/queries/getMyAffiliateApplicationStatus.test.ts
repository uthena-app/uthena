// getMyAffiliateApplicationStatus.test.ts — unit tests for the
// application-status read query.
//
// P13.1 Slice 1 — covers the 4 entry states the wizard page branches on.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ----- Supabase chain mock ------------------------------------------------

type ServerCall =
  | { method: 'from'; table: string }
  | { method: 'select'; payload: unknown }
  | { method: 'eq'; col: string; val: unknown }
  | { method: 'maybeSingle' }

const serverCalls: ServerCall[] = []
let serverQueue: Array<{ data: unknown; error: unknown }> = []

function makeServerChain() {
  const chain: any = {
    select(payload: unknown) {
      serverCalls.push({ method: 'select', payload })
      return chain
    },
    eq(col: string, val: unknown) {
      serverCalls.push({ method: 'eq', col, val })
      return chain
    },
    maybeSingle: vi.fn(async () => {
      serverCalls.push({ method: 'maybeSingle' })
      return serverQueue.shift() ?? { data: null, error: null }
    }),
  }
  return chain
}

const fakeServerSupabase = {
  from: vi.fn((table: string) => {
    serverCalls.push({ method: 'from', table })
    return makeServerChain()
  }),
  auth: {
    getUser: vi.fn(async () => ({ data: { user: mockUser } })),
  },
}

let mockUser: { id: string } | null = { id: 'user-1' }

vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: vi.fn(async () => fakeServerSupabase),
}))

vi.mock('@foundations/log/pino', () => ({
  loggerFor: () => ({
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  }),
}))

// ----- Lifecycle ----------------------------------------------------------

beforeEach(() => {
  serverCalls.length = 0
  serverQueue = []
  mockUser = { id: 'user-1' }
  fakeServerSupabase.from.mockClear()
  fakeServerSupabase.auth.getUser.mockClear()
  fakeServerSupabase.auth.getUser.mockImplementation(async () => ({
    data: { user: mockUser },
  }))
})

afterEach(() => {
  vi.clearAllMocks()
})

// ----- Import (after mocks) -----------------------------------------------

const { getMyAffiliateApplicationStatus } = await import('./getMyAffiliateApplicationStatus')

// =====================================================================
// Auth gating
// =====================================================================

describe('getMyAffiliateApplicationStatus — auth gating', () => {
  it('returns `{ kind: "none" }` for anonymous callers', async () => {
    mockUser = null
    fakeServerSupabase.auth.getUser.mockResolvedValueOnce({
      data: { user: null },
    })

    const result = await getMyAffiliateApplicationStatus()
    expect(result).toEqual({ kind: 'none' })
    // Critically: NO Supabase.from() call happens — we never even
    // attempt to read affiliates for an anonymous visitor.
    expect(fakeServerSupabase.from).not.toHaveBeenCalled()
  })

  it('returns `{ kind: "none" }` when the SELECT returns no row', async () => {
    serverQueue.push({ data: null, error: null })

    const result = await getMyAffiliateApplicationStatus()
    expect(result).toEqual({ kind: 'none' })

    expect(fakeServerSupabase.from).toHaveBeenCalledWith('affiliates')
    expect(
      serverCalls.some((c) => c.method === 'eq' && (c as { col: string }).col === 'user_id'),
    ).toBe(true)
  })

  it('returns `{ kind: "none" }` when the SELECT errors out', async () => {
    serverQueue.push({ data: null, error: { message: 'permission denied' } })

    const result = await getMyAffiliateApplicationStatus()
    expect(result).toEqual({ kind: 'none' })
  })
})

// =====================================================================
// 4 entry states
// =====================================================================

describe('getMyAffiliateApplicationStatus — happy paths', () => {
  it('returns `{ kind: "pending" }` for pending affiliates', async () => {
    serverQueue.push({
      data: {
        id: 42,
        user_id: 'user-1',
        status: 'pending',
        created_at: '2026-06-29T00:00:00Z',
      },
      error: null,
    })

    const result = await getMyAffiliateApplicationStatus()
    expect(result).toEqual({
      kind: 'pending',
      affiliateId: 42,
      submittedAt: '2026-06-29T00:00:00Z',
    })
  })

  it('returns `{ kind: "approved" }` for approved affiliates', async () => {
    serverQueue.push({
      data: {
        id: 42,
        user_id: 'user-1',
        status: 'approved',
        created_at: '2026-06-01T00:00:00Z',
      },
      error: null,
    })

    const result = await getMyAffiliateApplicationStatus()
    expect(result).toEqual({ kind: 'approved', affiliateId: 42 })
  })

  it('returns `{ kind: "suspended" }` for suspended affiliates', async () => {
    serverQueue.push({
      data: {
        id: 42,
        user_id: 'user-1',
        status: 'suspended',
        created_at: '2026-06-01T00:00:00Z',
      },
      error: null,
    })

    const result = await getMyAffiliateApplicationStatus()
    expect(result).toEqual({ kind: 'suspended', affiliateId: 42 })
  })
})

// =====================================================================
// Defensive coercion — corrupt rows must not block the wizard
// =====================================================================

describe('getMyAffiliateApplicationStatus — defensive coercion', () => {
  it('returns `{ kind: "none" }` for unknown status values', async () => {
    serverQueue.push({
      data: {
        id: 42,
        user_id: 'user-1',
        status: 'banned', // not yet a v1 status — defensive
        created_at: '2026-06-01T00:00:00Z',
      },
      error: null,
    })

    const result = await getMyAffiliateApplicationStatus()
    expect(result).toEqual({ kind: 'none' })
  })

  it('returns `{ kind: "none" }` when id is not a number', async () => {
    serverQueue.push({
      data: {
        id: '42', // wrong shape — should be number
        user_id: 'user-1',
        status: 'pending',
        created_at: '2026-06-29T00:00:00Z',
      },
      error: null,
    })

    const result = await getMyAffiliateApplicationStatus()
    // Per the partner-onboarding pattern: an unknown id shape falls
    // through to 'none' so the wizard can render. The user can re-apply.
    expect(result).toEqual({ kind: 'none' })
  })

  it('returns null submittedAt when created_at is missing', async () => {
    serverQueue.push({
      data: {
        id: 42,
        user_id: 'user-1',
        status: 'pending',
        // created_at missing
      },
      error: null,
    })

    const result = await getMyAffiliateApplicationStatus()
    expect(result).toEqual({
      kind: 'pending',
      affiliateId: 42,
      submittedAt: null,
    })
  })

  it('returns null submittedAt when created_at is non-string', async () => {
    serverQueue.push({
      data: {
        id: 42,
        user_id: 'user-1',
        status: 'pending',
        created_at: 1234567890, // numeric — wrong shape
      },
      error: null,
    })

    const result = await getMyAffiliateApplicationStatus()
    expect(result).toEqual({
      kind: 'pending',
      affiliateId: 42,
      submittedAt: null,
    })
  })
})