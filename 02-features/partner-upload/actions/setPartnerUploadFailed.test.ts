// setPartnerUploadFailed.test.ts — unit tests for the
// setPartnerUploadFailed server action (P12.8 Slice 1).

import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const mockRequirePartner = vi.hoisted(() => vi.fn())
vi.mock('@foundations/auth/guards', () => ({
  requirePartner: mockRequirePartner,
}))

const mockChain = vi.hoisted(() => ({
  readResult: { data: null as { id: string; partner_id: number; failure_kind: string | null; failure_reason: string | null } | null, error: null as { message: string } | null },
  updateCalls: [] as Array<Record<string, unknown>>,
  updateError: null as { message: string } | null,
  updateData: [{ id: '0' }] as Array<{ id: string }>,
}))
vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: () => buildSupabaseClient(mockChain),
  getServiceSupabase: () => buildSupabaseClient(mockChain),
}))

function buildSupabaseClient(chain: typeof mockChain) {
  return {
    from(table: string) {
      if (table !== 'partner_uploads') throw new Error(`Unexpected table ${table}`)
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve(chain.readResult),
          }),
        }),
        update: (values: Record<string, unknown>) => {
          chain.updateCalls.push(values)
          const u = {
            eq: (col: string, val: string) => {
              void col
              void val
              return {
                is: (_c: string, _v: null) => ({
                  select: () => Promise.resolve({
                    data: chain.updateData.length > 0 ? chain.updateData : null,
                    error: chain.updateError,
                  }),
                }),
              }
            },
          }
          // The chain `.eq('id', X).is('failure_kind', null).select('id')`
          // is needed for our action; we shortcut .eq returning a thenable
          // for the .is step.
          return u as never
        },
      }
    },
  }
}

const mockWriteSelfAuditLog = vi.hoisted(() => vi.fn().mockResolvedValue(1))
vi.mock('@features/account/profile/actions/writeSelfAuditLog', () => ({
  writeSelfAuditLog: mockWriteSelfAuditLog,
}))

vi.mock('@foundations/log/pino', () => ({
  loggerFor: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

import { setPartnerUploadFailedAction } from './setPartnerUploadFailed'

function partnerSession(overrides?: Partial<{ id: string; role: 'partner' | 'admin' | 'customer' }>) {
  return {
    id: overrides?.id ?? 'user-uuid-1',
    email: 'partner@example.com',
    role: overrides?.role ?? 'partner',
    display_name: 'Test Partner',
  }
}

beforeEach(() => {
  mockRequirePartner.mockReset()
  mockChain.readResult = { data: null, error: null }
  mockChain.updateCalls = []
  mockChain.updateError = null
  mockChain.updateData = [{ id: '0' }]
  mockWriteSelfAuditLog.mockClear()
})

describe('setPartnerUploadFailedAction — auth', () => {
  it('returns not_authenticated when requirePartner throws', async () => {
    mockRequirePartner.mockRejectedValueOnce(new Error('redirected'))
    const result = await setPartnerUploadFailedAction({
      uploadId: '42',
      failureKind: 'aborted',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('not_authenticated')
  })
  it('returns not_partner when role is customer', async () => {
    mockRequirePartner.mockResolvedValueOnce(partnerSession({ role: 'customer' }))
    const result = await setPartnerUploadFailedAction({
      uploadId: '42',
      failureKind: 'aborted',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('not_partner')
  })
})

describe('setPartnerUploadFailedAction — wire validation', () => {
  beforeEach(() => mockRequirePartner.mockResolvedValue(partnerSession()))
  it('returns invalid_input when uploadId is missing', async () => {
    const result = await setPartnerUploadFailedAction({
      failureKind: 'aborted',
    } as never)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('invalid_input')
  })
  it('returns invalid_input when uploadId is not numeric', async () => {
    const result = await setPartnerUploadFailedAction({
      uploadId: 'not-a-number',
      failureKind: 'aborted',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('invalid_input')
  })
  it('returns invalid_input when failureKind is not in the enum', async () => {
    const result = await setPartnerUploadFailedAction({
      uploadId: '42',
      failureKind: 'unknown',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('invalid_input')
  })
  it('returns invalid_input when failureReason exceeds 200 chars', async () => {
    const result = await setPartnerUploadFailedAction({
      uploadId: '42',
      failureKind: 'other',
      failureReason: 'x'.repeat(201),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('invalid_input')
  })
})

describe('setPartnerUploadFailedAction — not-found + update paths', () => {
  beforeEach(() => mockRequirePartner.mockResolvedValue(partnerSession()))
  it('returns not_found when the row does not exist', async () => {
    mockChain.readResult = { data: null, error: null }
    const result = await setPartnerUploadFailedAction({
      uploadId: '999',
      failureKind: 'aborted',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('not_found')
  })
  it('returns update_failed when the read errors', async () => {
    mockChain.readResult = { data: null, error: { message: 'db down' } }
    const result = await setPartnerUploadFailedAction({
      uploadId: '999',
      failureKind: 'aborted',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('update_failed')
  })
  it('returns update_failed when the update errors', async () => {
    mockChain.readResult = {
      data: { id: '42', partner_id: 1, failure_kind: null, failure_reason: null },
      error: null,
    }
    mockChain.updateError = { message: 'update failed' }
    const result = await setPartnerUploadFailedAction({
      uploadId: '42',
      failureKind: 'aborted',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('update_failed')
  })
})

describe('setPartnerUploadFailedAction — happy path + idempotency', () => {
  beforeEach(() => mockRequirePartner.mockResolvedValue(partnerSession()))
  it('updates the row + writes an audit row on first call', async () => {
    mockChain.readResult = {
      data: { id: '42', partner_id: 1, failure_kind: null, failure_reason: null },
      error: null,
    }
    const result = await setPartnerUploadFailedAction({
      uploadId: '42',
      failureKind: 'aborted',
      failureReason: 'User clicked cancel',
      clientReportedAt: new Date().toISOString(),
    })
    expect(result.ok).toBe(true)
    expect(mockChain.updateCalls.length).toBe(1)
    expect(mockChain.updateCalls[0]!.failure_kind).toBe('aborted')
    expect(mockChain.updateCalls[0]!.failure_reason).toBe('User clicked cancel')
    expect(mockWriteSelfAuditLog).toHaveBeenCalledTimes(1)
  })
  it('returns previous state without re-updating when the row already has a failure_kind', async () => {
    mockChain.readResult = {
      data: { id: '42', partner_id: 1, failure_kind: 'network', failure_reason: 'lost wifi' },
      error: null,
    }
    const result = await setPartnerUploadFailedAction({
      uploadId: '42',
      failureKind: 'aborted',
      failureReason: 'second attempt',
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.previousState.failureKind).toBe('network')
      expect(result.previousState.failureReason).toBe('lost wifi')
    }
    // No UPDATE was issued for the second-call idempotency surface.
    // (The read is the only DB call.)
    expect(mockChain.updateCalls.length).toBe(0)
  })
  it('does not call writeSelfAuditLog on idempotent (no-op) re-call', async () => {
    mockChain.readResult = {
      data: { id: '42', partner_id: 1, failure_kind: 'network', failure_reason: 'lost wifi' },
      error: null,
    }
    await setPartnerUploadFailedAction({
      uploadId: '42',
      failureKind: 'aborted',
    })
    expect(mockWriteSelfAuditLog).not.toHaveBeenCalled()
  })
})
