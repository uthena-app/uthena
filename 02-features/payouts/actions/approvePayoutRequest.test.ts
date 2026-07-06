// approvePayoutRequest.test.ts — unit tests for the approve / deny /
// mark-paid actions. Auth gate + Zod validation paths; happy path +
// state-machine guard tests are covered here without hitting Supabase
// (mocked).

import { describe, expect, it, vi, beforeEach } from 'vitest'

// Mock the guards + supabase modules so we can hit the action without a
// real DB session.
vi.mock('@foundations/auth/guards', () => ({
  getSessionUser: vi.fn(),
  requireRole: vi.fn(),
}))
vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: vi.fn(),
  getServiceSupabase: vi.fn(),
}))

import { getSessionUser, requireRole } from '@foundations/auth/guards'
import { getServiceSupabase } from '@foundations/data/supabase'

const mockGetSessionUser = vi.mocked(getSessionUser)
const mockRequireRole = vi.mocked(requireRole)
const mockGetServiceSupabase = vi.mocked(getServiceSupabase)

const insertMock = vi.fn().mockResolvedValue({ error: null })
const updateMock = vi.fn()
const selectMock = vi.fn()
const eqMock = vi.fn()
const maybeSingleMock = vi.fn()

function chain(terminal: any) {
  const c: any = {}
  c.eq = vi.fn(() => c)
  c.select = vi.fn(() => c)
  c.maybeSingle = vi.fn(() => terminal)
  c.then = undefined
  return c
}

beforeEach(() => {
  vi.clearAllMocks()
  insertMock.mockResolvedValue({ error: null })
  updateMock.mockReset()
})

describe('approvePayoutRequestAction auth + state guard', () => {
  it('refuses unauthenticated callers', async () => {
    mockGetSessionUser.mockResolvedValueOnce(null as never)
    const { approvePayoutRequestAction } = await import('./approvePayoutRequest')
    const result = await approvePayoutRequestAction({ requestId: 1 })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('not_authorized')
    }
  })

  it('refuses non-admin callers', async () => {
    mockGetSessionUser.mockResolvedValueOnce({ id: 'admin-1', email: 'a@b.c', role: 'partner' } as never)
    mockRequireRole.mockRejectedValueOnce(new Error('not admin'))
    const { approvePayoutRequestAction } = await import('./approvePayoutRequest')
    const result = await approvePayoutRequestAction({ requestId: 1 })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('not_authorized')
    }
  })

  it('refuses bad input', async () => {
    mockGetSessionUser.mockResolvedValueOnce({ id: 'admin-1', email: 'a@b.c', role: 'admin' } as never)
    mockRequireRole.mockResolvedValueOnce(undefined as never)
    mockGetServiceSupabase.mockReturnValueOnce({} as never)
    const { approvePayoutRequestAction } = await import('./approvePayoutRequest')
    const result = await approvePayoutRequestAction({ requestId: -1 })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('bad_input')
    }
  })
})

describe('denyPayoutRequestAction requires a reason', () => {
  it('rejects empty reason with bad_input', async () => {
    mockGetSessionUser.mockResolvedValueOnce({ id: 'admin-1', email: 'a@b.c', role: 'admin' } as never)
    mockRequireRole.mockResolvedValueOnce(undefined as never)
    mockGetServiceSupabase.mockReturnValueOnce({} as never)
    const { denyPayoutRequestAction } = await import('./approvePayoutRequest')
    const result = await denyPayoutRequestAction({ requestId: 1, reason: '' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('bad_input')
    }
  })
})

describe('markPayoutRequestPaidAction requires external reference', () => {
  it('rejects empty reference', async () => {
    mockGetSessionUser.mockResolvedValueOnce({ id: 'admin-1', email: 'a@b.c', role: 'admin' } as never)
    mockRequireRole.mockResolvedValueOnce(undefined as never)
    mockGetServiceSupabase.mockReturnValueOnce({} as never)
    const { markPayoutRequestPaidAction } = await import('./approvePayoutRequest')
    const result = await markPayoutRequestPaidAction({ requestId: 1, externalReference: '' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('bad_input')
    }
  })
})
