// writeAnalyticsViewAuditLog.test.ts — unit tests for the analytics
// audit-log writer. Mocks the service-role Supabase client; asserts
// the row shape, the metadata bag, the segment handling, and PII
// safety.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockSelect = vi.fn()
const mockSingle = vi.fn()
const mockInsert = vi.fn()
const mockFrom = vi.fn()

function buildChainResult(data: unknown, error: unknown = null) {
  return { data, error }
}

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

import { writeAnalyticsViewAuditLog } from './writeAnalyticsViewAuditLog'
import type { AnalyticsRange } from '../types'

const PRESET_RANGE: AnalyticsRange = {
  kind: 'preset',
  preset: '30d',
  fromIso: '2026-06-02',
  toIso: '2026-07-01',
  days: 30,
}

function wireChain(result: { data: unknown; error: unknown }) {
  mockSingle.mockResolvedValue(result)
  mockSelect.mockReturnValue({ single: mockSingle })
  mockInsert.mockReturnValue({ select: mockSelect })
  mockFrom.mockReturnValue({ insert: mockInsert })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('writeAnalyticsViewAuditLog', () => {
  it('inserts one row into admin_audit_log with the correct action', async () => {
    wireChain(buildChainResult({ id: 1234 }, null))
    await writeAnalyticsViewAuditLog({
      adminId: 'admin-uuid',
      actorEmail: 'admin@uthena.com',
      range: PRESET_RANGE,
      segment: 'all',
      rowCount: 30,
    })
    expect(mockFrom).toHaveBeenCalledWith('admin_audit_log')
    expect(mockInsert).toHaveBeenCalledTimes(1)
    const insertArg = mockInsert.mock.calls[0]![0] as Record<string, unknown>
    expect(insertArg.action).toBe('admin.analytics_viewed')
    expect(insertArg.target_kind).toBe('analytics_daily')
    expect(insertArg.actor_id).toBe('admin-uuid')
    expect(insertArg.actor_email).toBe('admin@uthena.com')
  })

  it('metadata.before carries the date range + segment', async () => {
    wireChain(buildChainResult({ id: 1234 }, null))
    await writeAnalyticsViewAuditLog({
      adminId: 'admin-uuid',
      actorEmail: 'admin@uthena.com',
      range: PRESET_RANGE,
      segment: 'all',
      rowCount: 30,
    })
    const insertArg = mockInsert.mock.calls[0]![0] as Record<string, unknown>
    const metadata = insertArg.metadata as Record<string, unknown>
    const before = metadata.before as Record<string, unknown>
    expect(before.from).toBe('2026-06-02')
    expect(before.to).toBe('2026-07-01')
    expect(before.days).toBe(30)
    expect(before.rangeKind).toBe('preset')
    expect(before.segment).toBe('all')
  })

  it('does NOT include dimensionId when segment is "all"', async () => {
    wireChain(buildChainResult({ id: 1234 }, null))
    await writeAnalyticsViewAuditLog({
      adminId: 'admin-uuid',
      actorEmail: 'admin@uthena.com',
      range: PRESET_RANGE,
      segment: 'all',
      rowCount: 30,
    })
    const insertArg = mockInsert.mock.calls[0]![0] as Record<string, unknown>
    const metadata = insertArg.metadata as Record<string, unknown>
    const before = metadata.before as Record<string, unknown>
    expect(before.dimensionId).toBeUndefined()
  })

  it('includes dimensionId when segment is "category" / "partner" / "affiliate"', async () => {
    wireChain(buildChainResult({ id: 1234 }, null))
    await writeAnalyticsViewAuditLog({
      adminId: 'admin-uuid',
      actorEmail: 'admin@uthena.com',
      range: PRESET_RANGE,
      segment: 'partner',
      dimensionId: 42,
      rowCount: 30,
    })
    const insertArg = mockInsert.mock.calls[0]![0] as Record<string, unknown>
    const metadata = insertArg.metadata as Record<string, unknown>
    const before = metadata.before as Record<string, unknown>
    expect(before.segment).toBe('partner')
    expect(before.dimensionId).toBe('42')
  })

  it('stringifies non-bigint dimension IDs (defense in depth)', async () => {
    wireChain(buildChainResult({ id: 1234 }, null))
    await writeAnalyticsViewAuditLog({
      adminId: 'admin-uuid',
      actorEmail: 'admin@uthena.com',
      range: PRESET_RANGE,
      segment: 'affiliate',
      dimensionId: 'aff-uuid-here',
      rowCount: 7,
    })
    const insertArg = mockInsert.mock.calls[0]![0] as Record<string, unknown>
    const metadata = insertArg.metadata as Record<string, unknown>
    const before = metadata.before as Record<string, unknown>
    expect(before.dimensionId).toBe('aff-uuid-here')
  })

  it('stores rowCount in metadata', async () => {
    wireChain(buildChainResult({ id: 1234 }, null))
    await writeAnalyticsViewAuditLog({
      adminId: 'admin-uuid',
      actorEmail: 'admin@uthena.com',
      range: PRESET_RANGE,
      segment: 'all',
      rowCount: 365,
    })
    const insertArg = mockInsert.mock.calls[0]![0] as Record<string, unknown>
    const metadata = insertArg.metadata as Record<string, unknown>
    expect(metadata.rowCount).toBe(365)
  })

  it('forwards IP + UA when provided', async () => {
    wireChain(buildChainResult({ id: 1234 }, null))
    await writeAnalyticsViewAuditLog({
      adminId: 'admin-uuid',
      actorEmail: 'admin@uthena.com',
      range: PRESET_RANGE,
      segment: 'all',
      rowCount: 30,
      ipAddress: '203.0.113.42',
      userAgent: 'Mozilla/5.0 ...',
    })
    const insertArg = mockInsert.mock.calls[0]![0] as Record<string, unknown>
    expect(insertArg.ip).toBe('203.0.113.42')
    expect(insertArg.user_agent).toBe('Mozilla/5.0 ...')
  })

  it('defaults IP + UA to null', async () => {
    wireChain(buildChainResult({ id: 1234 }, null))
    await writeAnalyticsViewAuditLog({
      adminId: 'admin-uuid',
      actorEmail: 'admin@uthena.com',
      range: PRESET_RANGE,
      segment: 'all',
      rowCount: 30,
    })
    const insertArg = mockInsert.mock.calls[0]![0] as Record<string, unknown>
    expect(insertArg.ip).toBeNull()
    expect(insertArg.user_agent).toBeNull()
  })

  it('returns the audit row id on success', async () => {
    wireChain(buildChainResult({ id: 9876 }, null))
    const out = await writeAnalyticsViewAuditLog({
      adminId: 'admin-uuid',
      actorEmail: 'admin@uthena.com',
      range: PRESET_RANGE,
      segment: 'all',
      rowCount: 30,
    })
    expect(out).toBe(9876)
  })

  it('returns null + warns on DB error (fail-soft)', async () => {
    wireChain(buildChainResult(null, { message: 'insert failed' }))
    const out = await writeAnalyticsViewAuditLog({
      adminId: 'admin-uuid',
      actorEmail: 'admin@uthena.com',
      range: PRESET_RANGE,
      segment: 'all',
      rowCount: 30,
    })
    expect(out).toBeNull()
  })

  it('returns null + warns on empty result', async () => {
    wireChain(buildChainResult({}, null))
    const out = await writeAnalyticsViewAuditLog({
      adminId: 'admin-uuid',
      actorEmail: 'admin@uthena.com',
      range: PRESET_RANGE,
      segment: 'all',
      rowCount: 30,
    })
    expect(out).toBeNull()
  })

  it('PII safety: metadata.before does NOT include actor_email / customer email / IP', async () => {
    wireChain(buildChainResult({ id: 1234 }, null))
    await writeAnalyticsViewAuditLog({
      adminId: 'admin-uuid',
      actorEmail: 'admin@uthena.com',
      range: PRESET_RANGE,
      segment: 'all',
      rowCount: 30,
      ipAddress: '203.0.113.42',
    })
    const insertArg = mockInsert.mock.calls[0]![0] as Record<string, unknown>
    const metadata = JSON.stringify(insertArg.metadata)
    // IP goes to the top-level `ip` column (admin-readable for support),
    // not into the metadata bag.
    expect(metadata).not.toContain('203.0.113.42')
    expect(metadata).not.toContain('admin@uthena.com')
  })

  it('PII safety: actor_email is the top-level column, never embedded in metadata', async () => {
    wireChain(buildChainResult({ id: 1234 }, null))
    await writeAnalyticsViewAuditLog({
      adminId: 'admin-uuid',
      actorEmail: 'admin@uthena.com',
      range: PRESET_RANGE,
      segment: 'all',
      rowCount: 30,
    })
    const insertArg = mockInsert.mock.calls[0]![0] as Record<string, unknown>
    const metadata = JSON.stringify(insertArg.metadata)
    expect(metadata).not.toContain('admin@uthena.com')
    // The top-level actor_email column IS the audit trail's PII carrier
    // (per AGENTS.md rule 2 — admin reads are audited with actor email).
    expect(insertArg.actor_email).toBe('admin@uthena.com')
  })
})