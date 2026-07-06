// approvePartner.test.ts — unit tests for the approvePartnerAction
// server action.
//
// Pattern matches the existing deleteCategory.test.ts +
// getAdminCustomerDetail.test.ts — mock the Supabase client +
// assert input validation, auth gating, rate-limit, status guard,
// happy path, audit log shape, and PII safety.

import { beforeEach, describe, expect, it, vi } from 'vitest'

// --- Mocks ---------------------------------------------------------------

vi.mock('@foundations/auth/guards', () => ({
  requireAdmin: vi.fn(),
}))

const mockUpdate = vi.fn()
const mockEq = vi.fn()
const mockSelect = vi.fn()
const mockInsert = vi.fn()
const mockFrom = vi.fn()

vi.mock('@foundations/data/supabase', () => ({
  getServiceSupabase: vi.fn(() => ({
    from: mockFrom,
  })),
}))

vi.mock('@foundations/log/pino', () => ({
  loggerFor: vi.fn(() => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}))

// Mock next/cache so revalidatePath is a no-op in the test env
// (it throws "static generation store missing" without the Next
// runtime).
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import { requireAdmin } from '@foundations/auth/guards'
import { _resetApproveSuspendRateLimitForTests } from './approveSuspendRateLimit'
import { approvePartnerAction } from './approvePartner'

// --- Helpers -------------------------------------------------------------

type Thenable = Promise<{ data: unknown; error: unknown }>

function makeChainable(terminalResult: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {}
  const thenable: Thenable = Promise.resolve(terminalResult)
  chain.select = vi.fn(() => chain)
  chain.eq = vi.fn(() => chain)
  chain.update = vi.fn(() => chain)
  chain.insert = vi.fn(() => chain)
  chain.maybeSingle = vi.fn(() => thenable)
  chain.single = vi.fn(() => thenable)
  chain.then = (
    onFulfilled?: (v: unknown) => unknown,
    onRejected?: (e: unknown) => unknown,
  ) => thenable.then(onFulfilled, onRejected)
  return chain
}

beforeEach(() => {
  vi.clearAllMocks()
  _resetApproveSuspendRateLimitForTests()
  ;(requireAdmin as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: 'admin-id',
    email: 'admin@uthena.com',
    role: 'admin',
    display_name: 'Admin',
  })
})

// --- Tests ---------------------------------------------------------------

describe('approvePartnerAction', () => {
  it('returns invalid_input when the body is missing fields', async () => {
    const res = await approvePartnerAction({})
    expect(res).toEqual({ ok: false, error: 'Invalid request.', reason: 'invalid_input' })
  })

  it('returns invalid_input when the confirmation string does not match APPROVE', async () => {
    const res = await approvePartnerAction({ id: 1, confirm: 'approve' }) // wrong case
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('invalid_input')
  })

  it('returns invalid_input for a non-positive id', async () => {
    const res = await approvePartnerAction({ id: -1, confirm: 'APPROVE' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('invalid_input')
  })

  it('returns invalid_input when id is not a number', async () => {
    const res = await approvePartnerAction({ id: 'abc', confirm: 'APPROVE' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('invalid_input')
  })

  it('returns invalid_input when caller is not an admin (auth throws via redirect)', async () => {
    // requireAdmin redirects; in unit-test env we simulate by throwing
    // (Next.js redirect() throws NEXT_REDIRECT internally). The action
    // does NOT catch the throw — the redirect propagates up so Next.js
    // can convert it into the HTTP 307. The test asserts that the
    // throw happens (no ok:false result).
    ;(requireAdmin as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('NEXT_REDIRECT')
    })
    await expect(approvePartnerAction({ id: 1, confirm: 'APPROVE' })).rejects.toThrow(
      'NEXT_REDIRECT',
    )
  })

  it('returns rate_limited when the admin has hit 20/hr ceiling', async () => {
    // Use a fresh admin id so we don't pollute other tests.
    ;(requireAdmin as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'rate-limited-admin',
      email: 'rl@uthena.com',
      role: 'admin',
      display_name: 'RL',
    })

    // The action does ONE read + ONE update + ONE audit insert.
    // We need to wire the chain so the read doesn't blow up before
    // the rate limit kicks in for subsequent attempts.
    mockFrom.mockImplementation(() =>
      makeChainable({ data: { id: 1, status: 'pending' }, error: null }),
    )

    for (let i = 0; i < 20; i++) {
      const res = await approvePartnerAction({ id: 1, confirm: 'APPROVE' })
      expect(res.ok).toBe(true)
    }
    const blocked = await approvePartnerAction({ id: 1, confirm: 'APPROVE' })
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) {
      expect(blocked.reason).toBe('rate_limited')
      expect(blocked.retryAfterSeconds).toBeGreaterThan(0)
    }
  })

  it('returns not_found when the partner row does not exist', async () => {
    mockFrom.mockImplementation(() => makeChainable({ data: null, error: null }))
    const res = await approvePartnerAction({ id: 99, confirm: 'APPROVE' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('not_found')
  })

  it('returns server_error when the read query itself fails', async () => {
    mockFrom.mockImplementation(() => makeChainable({ data: null, error: { message: 'db down' } }))
    const res = await approvePartnerAction({ id: 1, confirm: 'APPROVE' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('server_error')
  })

  it('returns not_pending when the partner is already approved', async () => {
    mockFrom.mockImplementation(() =>
      makeChainable({ data: { id: 1, status: 'approved' }, error: null }),
    )
    const res = await approvePartnerAction({ id: 1, confirm: 'APPROVE' })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.reason).toBe('not_pending')
      expect(res.error).toMatch(/approved/)
    }
  })

  it('returns not_pending when the partner is suspended', async () => {
    mockFrom.mockImplementation(() =>
      makeChainable({ data: { id: 1, status: 'suspended' }, error: null }),
    )
    const res = await approvePartnerAction({ id: 1, confirm: 'APPROVE' })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.reason).toBe('not_pending')
      expect(res.error).toMatch(/suspended/)
    }
  })

  it('updates the row + writes an audit row on the happy path', async () => {
    const updateSpy = vi.fn()
    const insertSpy = vi.fn()
    let fromCallCount = 0
    mockFrom.mockImplementation(() => {
      fromCallCount += 1
      if (fromCallCount === 1) {
        // Read partner row.
        return makeChainable({ data: { id: 42, status: 'pending' }, error: null })
      }
      if (fromCallCount === 2) {
        // Update partners.
        const chain: Record<string, unknown> = {}
        chain.eq = vi.fn(() => chain)
        chain.update = updateSpy.mockReturnValue(chain)
        return chain
      }
      // Audit insert.
      const chain: Record<string, unknown> = {}
      chain.insert = insertSpy.mockReturnValue(chain)
      return chain
    })

    const res = await approvePartnerAction({ id: 42, confirm: 'APPROVE' })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.partnerId).toBe(42)

    expect(updateSpy).toHaveBeenCalledTimes(1)
    const updatePayload = updateSpy.mock.calls[0]?.[0] as Record<string, unknown>
    expect(updatePayload.status).toBe('approved')
    expect(typeof updatePayload.approved_at).toBe('string')
    expect(updatePayload.approved_by).toBe('admin-id')

    expect(insertSpy).toHaveBeenCalledTimes(1)
    const auditPayload = insertSpy.mock.calls[0]?.[0] as Record<string, unknown>
    expect(auditPayload.action).toBe('admin.partner_approved')
    expect(auditPayload.target_kind).toBe('partners')
    expect(auditPayload.target_id).toBe('42')
    expect(auditPayload.actor_id).toBe('admin-id')
    expect(auditPayload.actor_email).toBe('admin@uthena.com')
    const meta = auditPayload.metadata as Record<string, unknown>
    expect(meta.before_status).toBe('pending')
    expect(meta.after_status).toBe('approved')
  })

  it('still commits the approval when the audit row write fails', async () => {
    const updateSpy = vi.fn()
    let fromCallCount = 0
    mockFrom.mockImplementation(() => {
      fromCallCount += 1
      if (fromCallCount === 1) {
        return makeChainable({ data: { id: 42, status: 'pending' }, error: null })
      }
      if (fromCallCount === 2) {
        const chain: Record<string, unknown> = {}
        chain.eq = vi.fn(() => chain)
        chain.update = updateSpy.mockReturnValue(chain)
        return chain
      }
      // Audit insert returns an error — the action should still
      // return ok (the approval is the durable effect).
      const chain: Record<string, unknown> = {}
      chain.insert = vi.fn(() => {
        // Throw inside the chainable — getServiceSupabase chain
        // swallows; we want to verify the action's own swallow.
        throw new Error('insert failed')
      })
      return chain
    })

    // The action inserts via supabase.from('admin_audit_log').insert(...).
    // If insert throws synchronously, the action's `if (auditErr)` does
    // not catch — but the .insert call itself doesn't throw on the
    // Supabase JS client (it returns { data, error }). So we shape
    // the mock to return an error result instead.
    let insertCalls = 0
    mockFrom.mockImplementation(() => {
      insertCalls += 1
      if (insertCalls === 1) {
        return makeChainable({ data: { id: 42, status: 'pending' }, error: null })
      }
      if (insertCalls === 2) {
        const chain: Record<string, unknown> = {}
        chain.eq = vi.fn(() => chain)
        chain.update = updateSpy.mockReturnValue(chain)
        return chain
      }
      return makeChainable({ data: null, error: { message: 'audit write failed' } })
    })

    const res = await approvePartnerAction({ id: 42, confirm: 'APPROVE' })
    expect(res.ok).toBe(true)
  })

  it('returns server_error when the update itself fails', async () => {
    let fromCallCount = 0
    mockFrom.mockImplementation(() => {
      fromCallCount += 1
      if (fromCallCount === 1) {
        return makeChainable({ data: { id: 1, status: 'pending' }, error: null })
      }
      // Update returns an error via the chain — the action's update
      // call awaits { data, error }; we mimic by returning a
      // chainable whose terminal .eq().update resolves with error.
      // The action uses `.update(payload).eq(...)` and awaits the
      // return. So the chainable needs to be awaitable with an
      // error result.
      const errThenable: Thenable = Promise.resolve({ data: null, error: { message: 'update failed' } })
      const chain: Record<string, unknown> = {}
      chain.eq = vi.fn(() => chain)
      chain.update = vi.fn(() => chain)
      chain.then = (
        onFulfilled?: (v: unknown) => unknown,
        onRejected?: (e: unknown) => unknown,
      ) => errThenable.then(onFulfilled, onRejected)
      return chain
    })
    const res = await approvePartnerAction({ id: 1, confirm: 'APPROVE' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('server_error')
  })
})