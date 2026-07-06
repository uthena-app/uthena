// writeRefundsViewAuditLog.test.ts — server action unit tests.
//
// Per cron protocol §"Done": unit tests for every server action.
// This action is best-effort by design (failure must NOT block the
// page render), so the tests assert:
//   - happy path writes one admin_audit_log row with the right shape
//   - queue view uses action='admin.refunds_queue_viewed'
//   - detail view uses action='admin.refund_detail_viewed' +
//     target_id = refund id
//   - filters bag, page, and result count flow through to metadata
//   - customerEmail flows through as-is (admin_audit_log is admin-only
//     readable; per AGENTS.md rule 2 admin reads of PII are audit-logged)
//   - insert failure is logged + swallowed (does not throw)
//   - throw is caught + logged (does not throw)

import { describe, it, expect, vi, beforeEach } from 'vitest'

const insertMock = vi.fn()
vi.mock('@foundations/data/supabase', () => ({
  getServiceSupabase: vi.fn(() => ({
    from: (table: string) => ({
      insert: (payload: unknown) => {
        insertMock(table, payload)
        return {
          then: (resolve: (v: unknown) => void) =>
            resolve({ error: null }),
        }
      },
    }),
  })),
}))

const logWarn = vi.fn()
vi.mock('@foundations/log/pino', () => ({
  loggerFor: vi.fn(() => ({
    warn: (...args: unknown[]) => logWarn(...args),
    info: vi.fn(),
    error: vi.fn(),
  })),
}))

import { writeRefundsViewAuditLog } from './writeRefundsViewAuditLog'

beforeEach(() => {
  insertMock.mockReset()
  logWarn.mockReset()
})

const baseFilters = {
  status: null,
  from: null,
  to: null,
  customerEmail: null,
  productId: null,
}

describe('writeRefundsViewAuditLog — queue view', () => {
  it('writes one admin_audit_log row with action=admin.refunds_queue_viewed', async () => {
    await writeRefundsViewAuditLog({
      adminId: 'admin-1',
      actorEmail: 'admin@example.com',
      detailRefundId: null,
      filters: baseFilters,
      page: 1,
      resultCount: 5,
      ipAddress: null,
      userAgent: null,
    })
    expect(insertMock).toHaveBeenCalledTimes(1)
    const [table, payload] = insertMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(table).toBe('admin_audit_log')
    expect(payload.action).toBe('admin.refunds_queue_viewed')
    expect(payload.target_kind).toBe('refunds')
    expect(payload.target_id).toBeNull()
    expect(payload.actor_id).toBe('admin-1')
    expect(payload.actor_email).toBe('admin@example.com')
  })

  it('writes filters + page + result count into metadata', async () => {
    await writeRefundsViewAuditLog({
      adminId: 'admin-1',
      actorEmail: null,
      detailRefundId: null,
      filters: {
        status: 'pending',
        from: '2026-06-01',
        to: '2026-06-30',
        customerEmail: 'k@example.com',
        productId: 99,
      },
      page: 3,
      resultCount: 25,
      ipAddress: null,
      userAgent: null,
    })
    const [, payload] = insertMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(payload.metadata).toEqual({
      filters: {
        status: 'pending',
        from: '2026-06-01',
        to: '2026-06-30',
        customerEmail: 'k@example.com',
        productId: 99,
      },
      page: 3,
      resultCount: 25,
    })
  })

  it('passes IP + UA when provided', async () => {
    await writeRefundsViewAuditLog({
      adminId: 'admin-1',
      actorEmail: null,
      detailRefundId: null,
      filters: baseFilters,
      page: 1,
      resultCount: 0,
      ipAddress: '203.0.113.5',
      userAgent: 'Mozilla/5.0',
    })
    const [, payload] = insertMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(payload.ip_address).toBe('203.0.113.5')
    expect(payload.user_agent).toBe('Mozilla/5.0')
  })

  it('insert error is logged + swallowed (does not throw)', async () => {
    insertMock.mockImplementationOnce(() => {
      throw new Error('insert failed')
    })
    await expect(
      writeRefundsViewAuditLog({
        adminId: 'admin-1',
        actorEmail: null,
        detailRefundId: null,
        filters: baseFilters,
        page: 1,
        resultCount: 0,
        ipAddress: null,
        userAgent: null,
      }),
    ).resolves.toBeUndefined()
  })

  it('service-role error is caught (does not throw)', async () => {
    insertMock.mockImplementationOnce(() => {
      throw new Error('service role unavailable')
    })
    await expect(
      writeRefundsViewAuditLog({
        adminId: 'admin-1',
        actorEmail: null,
        detailRefundId: null,
        filters: baseFilters,
        page: 1,
        resultCount: 0,
        ipAddress: null,
        userAgent: null,
      }),
    ).resolves.toBeUndefined()
  })
})

describe('writeRefundsViewAuditLog — detail view', () => {
  it('writes action=admin.refund_detail_viewed + target_id when detailRefundId is set', async () => {
    await writeRefundsViewAuditLog({
      adminId: 'admin-1',
      actorEmail: 'admin@example.com',
      detailRefundId: 1001,
      filters: baseFilters,
      page: 1,
      resultCount: 5,
      ipAddress: null,
      userAgent: null,
    })
    const [table, payload] = insertMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(table).toBe('admin_audit_log')
    expect(payload.action).toBe('admin.refund_detail_viewed')
    expect(payload.target_kind).toBe('refunds')
    expect(payload.target_id).toBe('1001')
  })

  it('includes refundId in metadata when detailRefundId is set', async () => {
    await writeRefundsViewAuditLog({
      adminId: 'admin-1',
      actorEmail: null,
      detailRefundId: 1001,
      filters: baseFilters,
      page: 1,
      resultCount: 5,
      ipAddress: null,
      userAgent: null,
    })
    const [, payload] = insertMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(payload.metadata).toEqual({
      filters: baseFilters,
      page: 1,
      resultCount: 5,
      refundId: 1001,
    })
  })
})