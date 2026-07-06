// getMemberSince.test.ts — unit tests for the getMemberSince query
// that backs the "/account/profile" header lede. Covers:
//
//   - Happy path: ISO created_at → "Member since {Month YYYY}" in
//     en-US locale.
//   - Defensive fallbacks: missing row → "Member since recently",
//     missing created_at → "Member since recently", DB error → same
//     fallback (fail-soft).
//   - Query shape: minimal select('created_at') + user_id filter.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Call =
  | { method: 'select'; payload: string }
  | { method: 'eq'; col: string; val: unknown }
  | { method: 'maybeSingle' }

const calls: Call[] = []
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
}
vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: vi.fn(async () => fakeSupabase),
}))

const { getMemberSince } = await import('./getMemberSince')

beforeEach(() => {
  calls.length = 0
  queryResponse = { data: null, error: null }
  fakeSupabase.from.mockClear()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('getMemberSince — happy path', () => {
  it('formats "Member since {Month YYYY}" from an ISO created_at (en-US, long month + numeric year)', async () => {
    queryResponse = { data: { created_at: '2025-01-15T00:00:00Z' }, error: null }
    const result = await getMemberSince('user-uuid-1')
    expect(result).toBe('Member since January 2025')
  })

  it('formats a date in another month correctly', async () => {
    queryResponse = { data: { created_at: '2024-07-04T00:00:00Z' }, error: null }
    const result = await getMemberSince('user-uuid-1')
    expect(result).toBe('Member since July 2024')
  })
})

describe('getMemberSince — defensive fallbacks', () => {
  it('returns "Member since recently" when the row is missing', async () => {
    queryResponse = { data: null, error: null }
    const result = await getMemberSince('user-uuid-1')
    expect(result).toBe('Member since recently')
  })

  it('returns "Member since recently" when created_at is null', async () => {
    queryResponse = { data: { created_at: null }, error: null }
    const result = await getMemberSince('user-uuid-1')
    expect(result).toBe('Member since recently')
  })

  it('returns "Member since recently" on DB error (fail-soft)', async () => {
    queryResponse = { data: null, error: { message: 'connection refused' } }
    const result = await getMemberSince('user-uuid-1')
    expect(result).toBe('Member since recently')
  })
})

describe('getMemberSince — query shape', () => {
  it('uses minimal select("created_at")', async () => {
    queryResponse = { data: { created_at: '2025-01-15T00:00:00Z' }, error: null }
    await getMemberSince('user-uuid-1')
    const selectCall = calls.find((c) => c.method === 'select')
    expect(selectCall).toBeDefined()
    if (selectCall?.method === 'select') {
      expect(selectCall.payload).toBe('created_at')
    }
  })

  it('filters by user_id (RLS-friendly)', async () => {
    queryResponse = { data: null, error: null }
    await getMemberSince('user-uuid-2')
    const eqCall = calls.find((c) => c.method === 'eq')
    expect(eqCall).toBeDefined()
    if (eqCall?.method === 'eq') {
      expect(eqCall.col).toBe('user_id')
      expect(eqCall.val).toBe('user-uuid-2')
    }
  })

  it('uses maybeSingle (not single) — defensive against missing rows', async () => {
    queryResponse = { data: null, error: null }
    await getMemberSince('user-uuid-1')
    const maybeSingleCall = calls.find((c) => c.method === 'maybeSingle')
    expect(maybeSingleCall).toBeDefined()
  })
})