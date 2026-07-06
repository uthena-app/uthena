// suspendPartner.test.ts — unit tests for the suspendPartnerAction
// server action.
//
// Pattern matches approvePartner.test.ts.

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@foundations/auth/guards', () => ({
  requireAdmin: vi.fn(),
}))

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

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import { requireAdmin } from '@foundations/auth/guards'
import { _resetApproveSuspendRateLimitForTests } from './approveSuspendRateLimit'
import { suspendPartnerAction } from './suspendPartner'

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

describe('suspendPartnerAction', () => {
  it('returns invalid_input when the body is missing fields', async () => {
    const res = await suspendPartnerAction({})
    expect(res).toEqual({ ok: false, error: 'Invalid request.', reason: 'invalid_input' })
  })

  it('returns invalid_input when the reason is empty after trim', async () => {
    const res = await suspendPartnerAction({ id: 1, confirm: 'SUSPEND', reason: '   ' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('invalid_input')
  })

  it('returns invalid_input when the reason is missing entirely', async () => {
    const res = await suspendPartnerAction({ id: 1, confirm: 'SUSPEND' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('invalid_input')
  })

  it('returns invalid_input when the confirmation string is wrong', async () => {
    const res = await suspendPartnerAction({ id: 1, confirm: 'suspend', reason: 'ok' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('invalid_input')
  })

  it('returns invalid_input for unknown extra fields (strict mode)', async () => {
    const res = await suspendPartnerAction({
      id: 1,
      confirm: 'SUSPEND',
      reason: 'ok',
      extra: 'field',
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('invalid_input')
  })

  it('returns not_found when the partner row does not exist', async () => {
    mockFrom.mockImplementation(() => makeChainable({ data: null, error: null }))
    const res = await suspendPartnerAction({ id: 99, confirm: 'SUSPEND', reason: 'spam' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('not_found')
  })

  it('returns server_error when the read query fails', async () => {
    mockFrom.mockImplementation(() => makeChainable({ data: null, error: { message: 'db down' } }))
    const res = await suspendPartnerAction({ id: 1, confirm: 'SUSPEND', reason: 'spam' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('server_error')
  })

  it('returns not_approved when the partner is already suspended', async () => {
    mockFrom.mockImplementation(() =>
      makeChainable({ data: { id: 1, status: 'suspended' }, error: null }),
    )
    const res = await suspendPartnerAction({ id: 1, confirm: 'SUSPEND', reason: 'spam' })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.reason).toBe('not_approved')
      expect(res.error).toMatch(/suspended/)
    }
  })

  it('returns not_approved when the partner is still pending', async () => {
    mockFrom.mockImplementation(() =>
      makeChainable({ data: { id: 1, status: 'pending' }, error: null }),
    )
    const res = await suspendPartnerAction({ id: 1, confirm: 'SUSPEND', reason: 'spam' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('not_approved')
  })

  it('updates the row + writes an audit row with reason on the happy path', async () => {
    const updateSpy = vi.fn()
    const insertSpy = vi.fn()
    let fromCallCount = 0
    mockFrom.mockImplementation(() => {
      fromCallCount += 1
      if (fromCallCount === 1) {
        return makeChainable({ data: { id: 42, status: 'approved' }, error: null })
      }
      if (fromCallCount === 2) {
        const chain: Record<string, unknown> = {}
        chain.eq = vi.fn(() => chain)
        chain.update = updateSpy.mockReturnValue(chain)
        return chain
      }
      const chain: Record<string, unknown> = {}
      chain.insert = insertSpy.mockReturnValue(chain)
      return chain
    })

    const res = await suspendPartnerAction({
      id: 42,
      confirm: 'SUSPEND',
      reason: 'Repeated refund fraud',
    })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.partnerId).toBe(42)

    expect(updateSpy).toHaveBeenCalledTimes(1)
    const updatePayload = updateSpy.mock.calls[0]?.[0] as Record<string, unknown>
    expect(updatePayload.status).toBe('suspended')
    // approved_at / approved_by must NOT be touched on suspend —
    // a future unsuspend preserves them.
    expect(updatePayload.approved_at).toBeUndefined()
    expect(updatePayload.approved_by).toBeUndefined()

    expect(insertSpy).toHaveBeenCalledTimes(1)
    const auditPayload = insertSpy.mock.calls[0]?.[0] as Record<string, unknown>
    expect(auditPayload.action).toBe('admin.partner_suspended')
    expect(auditPayload.target_kind).toBe('partners')
    expect(auditPayload.target_id).toBe('42')
    const meta = auditPayload.metadata as Record<string, unknown>
    expect(meta.before_status).toBe('approved')
    expect(meta.after_status).toBe('suspended')
    expect(meta.reason).toBe('Repeated refund fraud')
  })

  it('trims reason whitespace before storing in audit metadata', async () => {
    const insertSpy = vi.fn()
    let fromCallCount = 0
    mockFrom.mockImplementation(() => {
      fromCallCount += 1
      if (fromCallCount === 1) {
        return makeChainable({ data: { id: 1, status: 'approved' }, error: null })
      }
      if (fromCallCount === 2) {
        const chain: Record<string, unknown> = {}
        chain.eq = vi.fn(() => chain)
        chain.update = vi.fn(() => chain)
        return chain
      }
      const chain: Record<string, unknown> = {}
      chain.insert = insertSpy.mockReturnValue(chain)
      return chain
    })

    const res = await suspendPartnerAction({
      id: 1,
      confirm: 'SUSPEND',
      reason: '   chargeback spike   ',
    })
    expect(res.ok).toBe(true)
    const auditPayload = insertSpy.mock.calls[0]?.[0] as Record<string, unknown>
    const meta = auditPayload.metadata as Record<string, unknown>
    expect(meta.reason).toBe('chargeback spike')
  })

  it('rejects a reason longer than 500 chars', async () => {
    const res = await suspendPartnerAction({
      id: 1,
      confirm: 'SUSPEND',
      reason: 'a'.repeat(501),
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('invalid_input')
  })

  it('rate limit shares the bucket with approvePartnerAction (20/hr/admin)', async () => {
    ;(requireAdmin as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'shared-rl-admin',
      email: 'shared@uthena.com',
      role: 'admin',
      display_name: 'Shared',
    })
    mockFrom.mockImplementation(() =>
      makeChainable({ data: { id: 1, status: 'approved' }, error: null }),
    )

    // 20 attempts should pass.
    for (let i = 0; i < 20; i++) {
      const res = await suspendPartnerAction({
        id: 1,
        confirm: 'SUSPEND',
        reason: 'spam',
      })
      expect(res.ok).toBe(true)
    }
    // 21st attempt — denied.
    const blocked = await suspendPartnerAction({
      id: 1,
      confirm: 'SUSPEND',
      reason: 'spam',
    })
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) expect(blocked.reason).toBe('rate_limited')
  })
})