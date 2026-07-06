// getMyPartnerApplicationStatus.test.ts — unit tests for the
// application-state query used by /partner/onboarding to dispatch
// to the right surface (wizard vs pending-review vs redirect).
//
// P12.1 Slice 1 — covers auth gating, status mapping (pending /
// approved / suspended), and defensive coercion of `id`.

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

const { getMyPartnerApplicationStatus } = await import('./getMyPartnerApplicationStatus')

// =====================================================================
// Auth gating
// =====================================================================

describe('getMyPartnerApplicationStatus — auth gating', () => {
  it('returns `{ kind: "none" }` for anonymous callers', async () => {
    mockUser = null
    fakeServerSupabase.auth.getUser.mockResolvedValueOnce({
      data: { user: null },
    })

    const result = await getMyPartnerApplicationStatus()
    expect(result).toEqual({ kind: 'none' })
    expect(fakeServerSupabase.from).not.toHaveBeenCalled()
  })

  it('returns `{ kind: "none" }` when no partner row exists', async () => {
    serverQueue.push({ data: null, error: null })

    const result = await getMyPartnerApplicationStatus()
    expect(result).toEqual({ kind: 'none' })
    expect(fakeServerSupabase.from).toHaveBeenCalledWith('partners')
  })

  it('returns `{ kind: "none" }` when the SELECT errors out', async () => {
    serverQueue.push({ data: null, error: { message: 'permission denied' } })

    const result = await getMyPartnerApplicationStatus()
    expect(result).toEqual({ kind: 'none' })
  })
})

// =====================================================================
// Status mapping
// =====================================================================

describe('getMyPartnerApplicationStatus — status mapping', () => {
  it('returns `{ kind: "pending" }` for status "pending"', async () => {
    serverQueue.push({
      data: { id: 42, user_id: 'user-1', status: 'pending', created_at: '2026-06-20T10:00:00Z' },
      error: null,
    })

    const result = await getMyPartnerApplicationStatus()
    expect(result.kind).toBe('pending')
    if (result.kind === 'pending') {
      expect(result.partnerId).toBe(42)
      expect(result.submittedAt).toBe('2026-06-20T10:00:00Z')
    }
  })

  it('returns `{ kind: "approved" }` for status "approved"', async () => {
    serverQueue.push({
      data: { id: 42, user_id: 'user-1', status: 'approved', created_at: '2026-06-20T10:00:00Z' },
      error: null,
    })

    const result = await getMyPartnerApplicationStatus()
    expect(result.kind).toBe('approved')
    if (result.kind === 'approved') {
      expect(result.partnerId).toBe(42)
    }
  })

  it('returns `{ kind: "suspended" }` for status "suspended"', async () => {
    serverQueue.push({
      data: { id: 42, user_id: 'user-1', status: 'suspended', created_at: '2026-06-20T10:00:00Z' },
      error: null,
    })

    const result = await getMyPartnerApplicationStatus()
    expect(result.kind).toBe('suspended')
    if (result.kind === 'suspended') {
      expect(result.partnerId).toBe(42)
    }
  })
})

// =====================================================================
// Defensive coercion
// =====================================================================

describe('getMyPartnerApplicationStatus — defensive coercion', () => {
  it('returns `{ kind: "none" }` for an unknown status string', async () => {
    serverQueue.push({
      data: { id: 42, user_id: 'user-1', status: 'weird-new-state', created_at: '2026-06-20T10:00:00Z' },
      error: null,
    })

    const result = await getMyPartnerApplicationStatus()
    expect(result).toEqual({ kind: 'none' })
  })

  it('returns `{ kind: "none" }` when partner id is not a number', async () => {
    serverQueue.push({
      data: { id: '42-string', user_id: 'user-1', status: 'pending', created_at: '2026-06-20T10:00:00Z' },
      error: null,
    })

    const result = await getMyPartnerApplicationStatus()
    // The defensive guard in the source maps to 'none' when partnerId
    // comes back as a non-number even if status is recognizable.
    expect(result).toEqual({ kind: 'none' })
  })

  it('returns `{ kind: "pending" }` with submittedAt=null when created_at is missing', async () => {
    serverQueue.push({
      data: { id: 42, user_id: 'user-1', status: 'pending' },
      error: null,
    })

    const result = await getMyPartnerApplicationStatus()
    expect(result.kind).toBe('pending')
    if (result.kind === 'pending') {
      expect(result.submittedAt).toBeNull()
    }
  })
})
