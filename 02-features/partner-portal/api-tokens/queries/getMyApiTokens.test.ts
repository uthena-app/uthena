// Unit tests for `getMyApiTokens` — P12.19.
//
// What we verify:
//   - Anon path: returns `[]` and does NOT issue the query.
//   - Auth path: queries `api_tokens` with the PII-safe select
//     (asserted against the exact select payload — never `token_hash`).
//   - User-scoped: filter is `.eq('user_id', user.id)`.
//   - Defensive mapping:
//       - Active row → mapped correctly
//       - Revoked row → status = 'revoked'
//       - Expired row → status = 'expired'
//       - Missing required field → row skipped
//       - Bad scope string → scope dropped (defensive)
//   - Sort order: revoked_at asc nulls first, expires_at asc nulls last,
//     created_at desc (active rows at the top of the visual list).
//   - DB error: returns `[]`, never throws.

import { describe, expect, it, vi, beforeEach } from 'vitest'

// Mock `getServerSupabase` so we can stage the chain.
const getUserMock = vi.fn()
const fromSelectMock = vi.fn()
const selectEqMock = vi.fn()
const orderMock = vi.fn()
const limitMock = vi.fn()

vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: async () => ({
    auth: { getUser: getUserMock },
    from: () => ({
      select: fromSelectMock,
    }),
  }),
}))

import { getMyApiTokens } from './getMyApiTokens'

function buildChain(result: { data: unknown[] | null; error: unknown }) {
  fromSelectMock.mockReturnValue({ eq: selectEqMock })
  selectEqMock.mockReturnValue({ order: orderMock })
  orderMock
    .mockReturnValueOnce({ order: orderMock })
    .mockReturnValueOnce({ order: orderMock })
    .mockReturnValue({ limit: limitMock })
  limitMock.mockReturnValue({ ...result })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getMyApiTokens — anon', () => {
  it('returns [] without calling .from() when there is no user', async () => {
    getUserMock.mockReturnValue({ data: { user: null }, error: null })
    const out = await getMyApiTokens()
    expect(out).toEqual([])
    expect(fromSelectMock).not.toHaveBeenCalled()
  })
})

describe('getMyApiTokens — authed', () => {
  const USER_ID = '11111111-2222-3333-4444-555555555555'

  beforeEach(() => {
    getUserMock.mockReturnValue({ data: { user: { id: USER_ID } }, error: null })
  })

  it('issues the PII-safe select against api_tokens for the current user', async () => {
    buildChain({ data: [], error: null })
    await getMyApiTokens()
    expect(fromSelectMock).toHaveBeenCalledTimes(1)
    const [selectArg] = fromSelectMock.mock.calls[0]!
    expect(selectArg).toBe(
      'id, name, scopes, token_prefix, created_at, expires_at, revoked_at, last_used_at',
    )
    expect(selectArg).not.toContain('token_hash')
    expect(selectEqMock).toHaveBeenCalledWith('user_id', USER_ID)
  })

  it('orders revoked first-nulls, expires asc nulls last, created_at desc', async () => {
    buildChain({ data: [], error: null })
    await getMyApiTokens()
    const orderCalls = orderMock.mock.calls.map((c) => c[0])
    expect(orderCalls).toEqual(['revoked_at', 'expires_at', 'created_at'])
    const orders = orderMock.mock.calls.map((c) => c[1])
    expect(orders[0]).toMatchObject({ ascending: true, nullsFirst: true })
    expect(orders[1]).toMatchObject({ ascending: true, nullsFirst: false })
    expect(orders[2]).toMatchObject({ ascending: false })
    expect(limitMock).toHaveBeenCalledWith(50)
  })

  it('maps an active row correctly', async () => {
    buildChain({
      data: [
        {
          id: 1,
          name: 'Zapier',
          scopes: ['read_sales', 'read_payouts'],
          token_prefix: 'uth_pat_a1b2c3d4***',
          created_at: '2026-06-30T00:00:00.000Z',
          expires_at: '2026-09-30T00:00:00.000Z',
          revoked_at: null,
          last_used_at: null,
        },
      ],
      error: null,
    })
    const out = await getMyApiTokens()
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      id: 1,
      name: 'Zapier',
      scopes: ['read_sales', 'read_payouts'],
      tokenPrefix: 'uth_pat_a1b2c3d4***',
      status: 'active',
    })
    expect(out[0]!.expiresAt).toBe('2026-09-30T00:00:00.000Z')
    expect(out[0]!.revokedAt).toBeNull()
  })

  it('maps a revoked row to status="revoked"', async () => {
    buildChain({
      data: [
        {
          id: 2,
          name: 'Old',
          scopes: ['read_sales'],
          token_prefix: 'uth_pat_1111****',
          created_at: '2026-05-01T00:00:00.000Z',
          expires_at: null,
          revoked_at: '2026-06-15T12:00:00.000Z',
          last_used_at: null,
        },
      ],
      error: null,
    })
    const out = await getMyApiTokens()
    expect(out[0]!.status).toBe('revoked')
  })

  it('maps an expired row to status="expired" (past expires_at, not revoked)', async () => {
    buildChain({
      data: [
        {
          id: 3,
          name: 'Old',
          scopes: ['read_sales'],
          token_prefix: 'uth_pat_2222****',
          created_at: '2025-01-01T00:00:00.000Z',
          expires_at: '2026-01-01T00:00:00.000Z',
          revoked_at: null,
          last_used_at: null,
        },
      ],
      error: null,
    })
    const out = await getMyApiTokens()
    expect(out[0]!.status).toBe('expired')
  })

  it('maps a never-expires row to status="active"', async () => {
    buildChain({
      data: [
        {
          id: 4,
          name: 'Never',
          scopes: ['read_products'],
          token_prefix: 'uth_pat_3333****',
          created_at: '2026-06-30T00:00:00.000Z',
          expires_at: null,
          revoked_at: null,
          last_used_at: null,
        },
      ],
      error: null,
    })
    const out = await getMyApiTokens()
    expect(out[0]!.status).toBe('active')
  })

  it('skips malformed rows (missing id) and keeps the rest', async () => {
    buildChain({
      data: [
        {
          id: null,
          name: 'Broken',
          scopes: [],
          token_prefix: 'uth_pat_xxxx****',
          created_at: '2026-06-30T00:00:00.000Z',
          expires_at: null,
          revoked_at: null,
          last_used_at: null,
        },
        {
          id: 5,
          name: 'Good',
          scopes: ['read_sales'],
          token_prefix: 'uth_pat_5555****',
          created_at: '2026-06-30T00:00:00.000Z',
          expires_at: null,
          revoked_at: null,
          last_used_at: null,
        },
      ],
      error: null,
    })
    const out = await getMyApiTokens()
    expect(out).toHaveLength(1)
    expect(out[0]!.id).toBe(5)
  })

  it('drops unknown scope strings defensively', async () => {
    buildChain({
      data: [
        {
          id: 6,
          name: 'Mixed',
          scopes: ['read_sales', 'write_everything', 'read_payouts'],
          token_prefix: 'uth_pat_9999****',
          created_at: '2026-06-30T00:00:00.000Z',
          expires_at: null,
          revoked_at: null,
          last_used_at: null,
        },
      ],
      error: null,
    })
    const out = await getMyApiTokens()
    expect(out[0]!.scopes).toEqual(['read_sales', 'read_payouts'])
  })

  it('returns [] on DB error (never throws)', async () => {
    buildChain({ data: null, error: { message: 'permission denied' } })
    const out = await getMyApiTokens()
    expect(out).toEqual([])
  })
})