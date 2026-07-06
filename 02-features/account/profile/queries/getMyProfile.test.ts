// getMyProfile.test.ts — unit tests for the server query that
// backs /account/profile. Uses the same chainable-fake-Supabase
// pattern as the rest of the queries test suite (see
// getRefundConfirmation.test.ts). Covers:
//
//   - Anon caller → null, no DB call (defense in depth; the page
//     also redirects via requireUser, but the query must hold the
//     same contract for any future direct caller).
//   - Happy path → returns the mapped shape with email +
//     email_verified derived from auth.users.email_confirmed_at.
//   - DB error → null (no throw; the page's redirect to
//     /account/overview catches null).
//   - Empty result → null (no profile row, but auth user exists).
//   - Query shape: explicit `user_id` predicate AND the minimal
//     PII-safe select payload (no role leak even though role is
//     public — the spec keeps the contract tight).
//   - email_verified true when email_confirmed_at is set, false
//     otherwise.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Call =
  | { method: 'select'; payload: string }
  | { method: 'eq'; col: string; val: unknown }
  | { method: 'maybeSingle' }

const calls: Call[] = []
let mockUser:
  | { id: string; email: string | null; email_confirmed_at: string | null }
  | null = null
let queryResponse: { data: unknown; error: unknown } = { data: null, error: null }

function makeChain() {
  const chain: any = {
    select(payload: string) {
      calls.push({ method: 'select', payload })
      return chain
    },
    eq(col: string, val: unknown) {
      calls.push({ method: 'eq', col, val })
      return chain
    },
    maybeSingle: vi.fn(async () => {
      calls.push({ method: 'maybeSingle' })
      return queryResponse
    }),
  }
  return chain
}

const fakeSupabase = {
  from: vi.fn(() => makeChain()),
  auth: {
    getUser: vi.fn(async () => ({
      data: { user: mockUser },
      error: null,
    })),
  },
}
vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: vi.fn(async () => fakeSupabase),
}))

const { getMyProfile } = await import('./getMyProfile')

beforeEach(() => {
  calls.length = 0
  queryResponse = { data: null, error: null }
  mockUser = {
    id: 'user-uuid-1',
    email: 'klaas@example.com',
    email_confirmed_at: '2026-06-15T10:00:00Z',
  }
  fakeSupabase.from.mockClear()
  fakeSupabase.auth.getUser.mockClear()
  fakeSupabase.auth.getUser.mockImplementation(async () => ({
    data: { user: mockUser },
    error: null,
  }))
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('getMyProfile — auth gating', () => {
  it('returns null when no session user (no DB call)', async () => {
    mockUser = null
    const result = await getMyProfile()
    expect(result).toBeNull()
    expect(fakeSupabase.from).not.toHaveBeenCalled()
  })
})

describe('getMyProfile — happy path', () => {
  it('returns the mapped profile shape with email + email_verified=true when email_confirmed_at is set', async () => {
    queryResponse = {
      data: {
        user_id: 'user-uuid-1',
        display_name: 'Klaas',
        avatar_url: 'https://cdn.example.com/avatars/uuid.png',
        bio: 'A bio.',
        locale: 'en',
        timezone: 'UTC',
        role: 'customer',
        created_at: '2025-01-15T00:00:00Z',
        updated_at: '2026-06-20T00:00:00Z',
      },
      error: null,
    }
    const result = await getMyProfile()
    expect(result).toEqual({
      user_id: 'user-uuid-1',
      display_name: 'Klaas',
      avatar_url: 'https://cdn.example.com/avatars/uuid.png',
      bio: 'A bio.',
      locale: 'en',
      timezone: 'UTC',
      role: 'customer',
      created_at: '2025-01-15T00:00:00Z',
      updated_at: '2026-06-20T00:00:00Z',
      email: 'klaas@example.com',
      email_verified: true,
    })
  })

  it('returns email_verified=false when email_confirmed_at is null', async () => {
    mockUser = {
      id: 'user-uuid-1',
      email: 'pending@example.com',
      email_confirmed_at: null,
    }
    queryResponse = {
      data: {
        user_id: 'user-uuid-1',
        display_name: 'Pending',
        avatar_url: null,
        bio: null,
        locale: 'en',
        timezone: 'UTC',
        role: 'customer',
        created_at: '2025-01-15T00:00:00Z',
        updated_at: '2026-06-20T00:00:00Z',
      },
      error: null,
    }
    const result = await getMyProfile()
    expect(result?.email_verified).toBe(false)
    expect(result?.email).toBe('pending@example.com')
  })

  it('falls back to empty email when auth.users.email is null', async () => {
    mockUser = {
      id: 'user-uuid-1',
      email: null,
      email_confirmed_at: null,
    }
    queryResponse = {
      data: {
        user_id: 'user-uuid-1',
        display_name: 'No Email',
        avatar_url: null,
        bio: null,
        locale: 'en',
        timezone: 'UTC',
        role: 'customer',
        created_at: '2025-01-15T00:00:00Z',
        updated_at: '2026-06-20T00:00:00Z',
      },
      error: null,
    }
    const result = await getMyProfile()
    expect(result?.email).toBe('')
    expect(result?.email_verified).toBe(false)
  })
})

describe('getMyProfile — error & empty paths', () => {
  it('returns null when the DB query errors (fail-soft)', async () => {
    queryResponse = { data: null, error: { message: 'connection refused' } }
    const result = await getMyProfile()
    expect(result).toBeNull()
  })

  it('returns null when no profile row exists (auth user but no trigger-created profile)', async () => {
    queryResponse = { data: null, error: null }
    const result = await getMyProfile()
    expect(result).toBeNull()
  })
})

describe('getMyProfile — query shape (defensive contract)', () => {
  it('uses a minimal PII-safe select payload (no password columns, no ip, no user_agent)', async () => {
    queryResponse = {
      data: {
        user_id: 'user-uuid-1',
        display_name: 'Klaas',
        avatar_url: null,
        bio: null,
        locale: 'en',
        timezone: 'UTC',
        role: 'customer',
        created_at: '2025-01-15T00:00:00Z',
        updated_at: '2026-06-20T00:00:00Z',
      },
      error: null,
    }
    await getMyProfile()
    const selectCall = calls.find((c) => c.method === 'select')
    expect(selectCall).toBeDefined()
    if (selectCall?.method === 'select') {
      // Defense in depth: explicit field allowlist on a public-readable
      // table. Even if someone adds a sensitive column to the schema
      // later, the query stays tight.
      expect(selectCall.payload).toBe(
        'user_id, display_name, avatar_url, bio, locale, timezone, role, created_at, updated_at',
      )
      expect(selectCall.payload).not.toContain('password')
      expect(selectCall.payload).not.toContain('email')
      expect(selectCall.payload).not.toContain('ip')
      expect(selectCall.payload).not.toContain('user_agent')
    }
  })

  it('filters the read by user_id (RLS-friendly)', async () => {
    queryResponse = { data: null, error: null }
    await getMyProfile()
    const eqCall = calls.find((c) => c.method === 'eq')
    expect(eqCall).toBeDefined()
    if (eqCall?.method === 'eq') {
      expect(eqCall.col).toBe('user_id')
      expect(eqCall.val).toBe('user-uuid-1')
    }
  })

  it('uses maybeSingle (not single) — defensive against missing rows', async () => {
    queryResponse = { data: null, error: null }
    await getMyProfile()
    const maybeSingleCall = calls.find((c) => c.method === 'maybeSingle')
    expect(maybeSingleCall).toBeDefined()
  })
})