// writeSelfAuditLog.test.ts — unit tests for the self-service audit
// log helper used by every account/profile action. Covers:
//
//   - Happy path: insert → select('id').single() → returns the row id.
//   - DB error: returns null, warn log includes code + action but
//     NOT the user email / user_id / metadata (defense against
//     check:pii).
//   - Empty insert result: returns null + warn.
//   - Insert payload shape: maps SelfAuditInput → admin_audit_log
//     columns (actor_id, actor_email, action, target_kind, target_id,
//     metadata, ip, user_agent).
//   - IP/UA defaults to null when not provided.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Call =
  | { method: 'from'; table: string }
  | { method: 'insert'; payload: Record<string, unknown> }
  | { method: 'select'; payload: string }
  | { method: 'single' }

const calls: Call[] = []
let singleResponse: { data: unknown; error: unknown } = { data: { id: 99 }, error: null }

function makeChain() {
  const chain: any = {
    insert(payload: Record<string, unknown>) {
      calls.push({ method: 'insert', payload })
      return chain
    },
    select(payload: string) {
      calls.push({ method: 'select', payload })
      return chain
    },
    single: vi.fn(async () => {
      calls.push({ method: 'single' })
      return singleResponse
    }),
  }
  return chain
}

const fakeSupabase = {
  from: vi.fn((table: string) => {
    calls.push({ method: 'from', table })
    return makeChain()
  }),
}
vi.mock('@foundations/data/supabase', () => ({
  getServiceSupabase: vi.fn(() => fakeSupabase),
}))

const mockWarn = vi.fn()
vi.mock('@foundations/log/pino', () => ({
  loggerFor: () => ({
    info: vi.fn(),
    warn: (...args: unknown[]) => mockWarn(...args),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

const { writeSelfAuditLog } = await import('./writeSelfAuditLog')

beforeEach(() => {
  calls.length = 0
  mockWarn.mockClear()
  singleResponse = { data: { id: 99 }, error: null }
  fakeSupabase.from.mockClear()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('writeSelfAuditLog — happy path', () => {
  it('returns the inserted row id', async () => {
    const id = await writeSelfAuditLog({
      userId: 'user-uuid-1',
      userEmail: 'klaas@example.com',
      action: 'profile_self_update',
      targetKind: 'profiles',
      targetId: 'user-uuid-1',
      metadata: { before: { display_name: 'A' }, after: { display_name: 'B' } },
      ipAddress: '203.0.113.1',
      userAgent: 'Mozilla/5.0',
    })
    expect(id).toBe(99)
  })

  it('writes to the admin_audit_log table', async () => {
    await writeSelfAuditLog({
      userId: 'user-uuid-1',
      userEmail: 'klaas@example.com',
      action: 'profile_self_update',
      targetKind: 'profiles',
      targetId: 'user-uuid-1',
      metadata: {},
    })
    expect(calls[0]).toEqual({ method: 'from', table: 'admin_audit_log' })
  })

  it('inserts the mapped payload (SelfAuditInput → admin_audit_log columns)', async () => {
    await writeSelfAuditLog({
      userId: 'user-uuid-1',
      userEmail: 'klaas@example.com',
      action: 'session_signout_one',
      targetKind: 'auth.sessions',
      targetId: 'sess-uuid-2',
      metadata: { session_jti: 'jti-abc' },
      ipAddress: '203.0.113.1',
      userAgent: 'Mozilla/5.0 (Test)',
    })
    const insertCall = calls.find((c) => c.method === 'insert')
    expect(insertCall).toBeDefined()
    if (insertCall?.method === 'insert') {
      expect(insertCall.payload).toEqual({
        actor_id: 'user-uuid-1',
        actor_email: 'klaas@example.com',
        action: 'session_signout_one',
        target_kind: 'auth.sessions',
        target_id: 'sess-uuid-2',
        metadata: { session_jti: 'jti-abc' },
        ip: '203.0.113.1',
        user_agent: 'Mozilla/5.0 (Test)',
      })
    }
  })

  it('defaults ip + user_agent to null when not provided', async () => {
    await writeSelfAuditLog({
      userId: 'user-uuid-1',
      userEmail: 'klaas@example.com',
      action: 'profile_self_update',
      targetKind: 'profiles',
      targetId: 'user-uuid-1',
      metadata: {},
    })
    const insertCall = calls.find((c) => c.method === 'insert')
    if (insertCall?.method === 'insert') {
      expect(insertCall.payload.ip).toBeNull()
      expect(insertCall.payload.user_agent).toBeNull()
    }
  })

  it('chains select("id").single() to read back the inserted id', async () => {
    await writeSelfAuditLog({
      userId: 'user-uuid-1',
      userEmail: 'klaas@example.com',
      action: 'profile_self_update',
      targetKind: 'profiles',
      targetId: 'user-uuid-1',
      metadata: {},
    })
    const selectCall = calls.find((c) => c.method === 'select')
    const singleCall = calls.find((c) => c.method === 'single')
    expect(selectCall).toBeDefined()
    expect(singleCall).toBeDefined()
    if (selectCall?.method === 'select') {
      expect(selectCall.payload).toBe('id')
    }
  })
})

describe('writeSelfAuditLog — error & empty paths', () => {
  it('returns null + warn when the insert errors', async () => {
    singleResponse = {
      data: null,
      error: { message: 'connection refused' },
    }
    const id = await writeSelfAuditLog({
      userId: 'user-uuid-1',
      userEmail: 'klaas@example.com',
      action: 'profile_self_update',
      targetKind: 'profiles',
      targetId: 'user-uuid-1',
      metadata: { before: { display_name: 'A' } },
    })
    expect(id).toBeNull()
    expect(mockWarn).toHaveBeenCalledTimes(1)
  })

  it('returns null + warn when the insert returns no data', async () => {
    singleResponse = { data: null, error: null }
    const id = await writeSelfAuditLog({
      userId: 'user-uuid-1',
      userEmail: 'klaas@example.com',
      action: 'profile_self_update',
      targetKind: 'profiles',
      targetId: 'user-uuid-1',
      metadata: {},
    })
    expect(id).toBeNull()
    expect(mockWarn).toHaveBeenCalledTimes(1)
  })

  it('warn payload contains action + code + msg but NOT the user email / user_id / metadata (PII safety)', async () => {
    singleResponse = { data: null, error: { message: 'boom' } }
    await writeSelfAuditLog({
      userId: 'user-uuid-1',
      userEmail: 'klaas@example.com',
      action: 'profile_self_update',
      targetKind: 'profiles',
      targetId: 'user-uuid-1',
      metadata: { secret: 'must-not-leak' },
    })
    const [payload, msg] = mockWarn.mock.calls[0] ?? []
    expect(msg).toBe('writeSelfAuditLog: insert failed')
    expect(payload).toEqual({
      code: 'audit_write_failed',
      action: 'profile_self_update',
      msg: 'boom',
    })
    const blob = JSON.stringify(payload)
    expect(blob).not.toContain('klaas@example.com')
    expect(blob).not.toContain('user-uuid-1')
    expect(blob).not.toContain('secret')
    expect(blob).not.toContain('must-not-leak')
  })
})