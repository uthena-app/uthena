// updatePlatformSettingsFlags.test.ts — unit tests for the 3 server
// actions (addFlag / updateFlag / removeFlag). Mocks the Supabase
// service-role client + the auth guard + the headers() / audit-log
// helper. Same pattern as `updatePlatformSettingsGeneral.test.ts`.
//
// Strategy:
//   1. Reset module mocks per-test (vi.resetModules + vi.doMock).
//   2. Mock `getServiceSupabase` to return a chainable fake that
//      records calls + returns queued `{data, error}` responses.
//   3. Mock `requireRole` to return a known admin (or null).
//   4. Mock `headers` to return an empty Headers() (no IP/UA forwarded).
//   5. Invoke the action under test.
//   6. Assert the result shape + the audit-row payload + the chained
//      `.update()` payload.

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock infrastructure
// ---------------------------------------------------------------------------

// Shared admin identity for tests that expect an authenticated admin.
const ADMIN = { id: 'admin-uuid-1', email: 'admin@uthena.com' }

// Captured audit-log writes (so we can assert on `target_id` + metadata).
const auditCalls: Array<{
  key: string
  before: unknown
  after: unknown
}> = []

// The current platform_settings.flags value + updated_at per-test.
let currentFlags: unknown = []
let currentUpdatedAt = '2026-07-01T00:00:00.000Z'

// Per-test toggle: should requireRole return the admin?
let asAdmin = true

// Per-test toggle: should the update succeed?
let updateSucceeds = true

// Captured update payloads.
let lastUpdatePayload: Record<string, unknown> | null = null

// Fake Supabase client. Uses a queued response shape so each call
// returns its own `data/error` tuple.
type Chainable = {
  from: (table: string) => Chainable
  select: (cols?: string) => Chainable
  update: (payload: Record<string, unknown>) => Chainable
  eq: (col: string, val: unknown) => Chainable
  maybeSingle: () => Promise<{ data: unknown; error: unknown }>
  single: () => Promise<{ data: unknown; error: unknown }>
}

const fakeSupabase: Chainable = {
  from: () => fakeSupabase,
  select: () => fakeSupabase,
  update: (payload) => {
    lastUpdatePayload = payload
    return fakeSupabase
  },
  eq: () => fakeSupabase,
  maybeSingle: async () => {
    if (updateSucceeds) {
      return { data: { flags: currentFlags, updated_at: currentUpdatedAt }, error: null }
    }
    return { data: null, error: { message: 'mocked read failure' } }
  },
  single: async () => {
    if (updateSucceeds) {
      return {
        data: { updated_at: new Date().toISOString() },
        error: null,
      }
    }
    return { data: null, error: { message: 'mocked update failure' } }
  },
}

vi.mock('@foundations/data/supabase', () => ({
  getServiceSupabase: () => fakeSupabase,
}))

vi.mock('@foundations/auth/guards', () => ({
  requireRole: vi.fn(async () => (asAdmin ? ADMIN : null)),
}))

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers()),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('./writePlatformSettingsAuditLog', () => ({
  writePlatformSettingsAuditLog: vi.fn(async (input: { key: string; before: unknown; after: unknown }) => {
    auditCalls.push({ key: input.key, before: input.before, after: input.after })
    return auditCalls.length
  }),
}))

// ---------------------------------------------------------------------------
// Now we can import the action under test.
// ---------------------------------------------------------------------------

// Use a dynamic import so the mocks above are in place first.
let mod: typeof import('./updatePlatformSettingsFlags')

beforeEach(async () => {
  vi.resetModules()
  // Reset per-test state.
  auditCalls.length = 0
  lastUpdatePayload = null
  currentFlags = []
  currentUpdatedAt = '2026-07-01T00:00:00.000Z'
  asAdmin = true
  updateSucceeds = true
  mod = await import('./updatePlatformSettingsFlags')
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('addPlatformFlagAction', () => {
  it('rejects invalid input (empty key)', async () => {
    const result = await mod.addPlatformFlagAction({ key: '' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/fix the errors/i)
      expect(result.fieldErrors?.['key']).toBeDefined()
    }
  })

  it('rejects invalid input (uppercase key)', async () => {
    const result = await mod.addPlatformFlagAction({ key: 'Invalid-Key' })
    expect(result.ok).toBe(false)
  })

  it('rejects when caller is not admin', async () => {
    asAdmin = false
    const result = await mod.addPlatformFlagAction({ key: 'new_flag' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/not authorized/i)
    }
  })

  it('returns no-op when the key already exists (idempotent)', async () => {
    currentFlags = [
      { key: 'existing_flag', enabled: true, description: '', rollout_pct: null },
    ]
    const result = await mod.addPlatformFlagAction({ key: 'existing_flag' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.changed).toBe(false)
      expect(result.flags).toHaveLength(1)
    }
    // No update should have been issued.
    expect(lastUpdatePayload).toBe(null)
  })

  it('adds a new flag and writes the focused audit row', async () => {
    currentFlags = []
    const result = await mod.addPlatformFlagAction({
      key: 'new_flag',
      enabled: true,
      description: 'A new flag',
      rollout_pct: 50,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.changed).toBe(true)
      expect(result.flags).toHaveLength(1)
      expect(result.flags[0]).toEqual({
        key: 'new_flag',
        enabled: true,
        description: 'A new flag',
        rollout_pct: 50,
      })
      expect(result.auditId).toBeGreaterThan(0)
    }
    // The update payload should carry the new flag array.
    expect(lastUpdatePayload).not.toBe(null)
    expect((lastUpdatePayload as unknown as { flags: unknown[] }).flags).toHaveLength(1)
    // The audit row should be target_id='flags' with added=['new_flag'].
    expect(auditCalls).toHaveLength(1)
    expect(auditCalls[0]).toEqual({
      key: 'flags',
      before: expect.objectContaining({ added: ['new_flag'] }),
      after: { _diff_summary: true },
    })
  })

  it('survives an audit-log failure (returns ok, auditId=null)', async () => {
    currentFlags = []
    // Re-mock the audit writer to return null.
    const { writePlatformSettingsAuditLog } = await import('./writePlatformSettingsAuditLog')
    ;(writePlatformSettingsAuditLog as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null)
    const result = await mod.addPlatformFlagAction({ key: 'new_flag' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.auditId).toBe(null)
      expect(result.changed).toBe(true)
    }
  })

  it('returns friendly error when the DB read fails', async () => {
    updateSucceeds = false
    const result = await mod.addPlatformFlagAction({ key: 'new_flag' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/could not read/i)
    }
  })
})

describe('updatePlatformFlagAction', () => {
  it('rejects invalid input (empty patch)', async () => {
    const result = await mod.updatePlatformFlagAction({ key: 'foo' })
    expect(result.ok).toBe(false)
  })

  it('rejects when caller is not admin', async () => {
    asAdmin = false
    const result = await mod.updatePlatformFlagAction({ key: 'foo', enabled: true })
    expect(result.ok).toBe(false)
  })

  it('returns not-found when the key does not exist', async () => {
    currentFlags = [
      { key: 'other', enabled: true, description: '', rollout_pct: null },
    ]
    const result = await mod.updatePlatformFlagAction({ key: 'nonexistent', enabled: true })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/does not exist/i)
    }
  })

  it('returns no-op when the PATCH does not change anything', async () => {
    currentFlags = [
      { key: 'foo', enabled: true, description: 'desc', rollout_pct: null },
    ]
    const result = await mod.updatePlatformFlagAction({
      key: 'foo',
      enabled: true, // already true
      description: 'desc', // already 'desc'
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.changed).toBe(false)
    }
    expect(lastUpdatePayload).toBe(null)
    expect(auditCalls).toHaveLength(0)
  })

  it('updates an existing flag and writes the focused audit row', async () => {
    currentFlags = [
      { key: 'foo', enabled: false, description: 'old', rollout_pct: null },
    ]
    const result = await mod.updatePlatformFlagAction({
      key: 'foo',
      enabled: true,
      description: 'new',
      rollout_pct: 75,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.changed).toBe(true)
      expect(result.flags[0]).toEqual({
        key: 'foo',
        enabled: true,
        description: 'new',
        rollout_pct: 75,
      })
    }
    // Audit row should reflect only the changed fields.
    expect(auditCalls).toHaveLength(1)
    const diff = auditCalls[0]!.before as {
      added: string[]
      removed: string[]
      changed: Array<{ key: string; before: Record<string, unknown>; after: Record<string, unknown> }>
    }
    expect(diff.added).toEqual([])
    expect(diff.removed).toEqual([])
    expect(diff.changed).toEqual([
      {
        key: 'foo',
        before: { enabled: false, description: 'old', rollout_pct: null },
        after: { enabled: true, description: 'new', rollout_pct: 75 },
      },
    ])
  })

  it('allows toggling just one field', async () => {
    currentFlags = [
      { key: 'foo', enabled: false, description: 'desc', rollout_pct: null },
    ]
    const result = await mod.updatePlatformFlagAction({
      key: 'foo',
      enabled: true,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.changed).toBe(true)
    }
    const diff = auditCalls[0]!.before as {
      changed: Array<{ before: Record<string, unknown>; after: Record<string, unknown> }>
    }
    expect(diff.changed[0]?.before).toEqual({ enabled: false })
    expect(diff.changed[0]?.after).toEqual({ enabled: true })
  })
})

describe('removePlatformFlagAction', () => {
  it('rejects invalid input (missing key)', async () => {
    const result = await mod.removePlatformFlagAction({})
    expect(result.ok).toBe(false)
  })

  it('rejects when caller is not admin', async () => {
    asAdmin = false
    const result = await mod.removePlatformFlagAction({ key: 'foo' })
    expect(result.ok).toBe(false)
  })

  it('returns no-op when the key does not exist (idempotent)', async () => {
    currentFlags = [
      { key: 'foo', enabled: true, description: '', rollout_pct: null },
    ]
    const result = await mod.removePlatformFlagAction({ key: 'nonexistent' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.changed).toBe(false)
      expect(result.flags).toHaveLength(1)
    }
    expect(lastUpdatePayload).toBe(null)
  })

  it('removes the flag and writes the focused audit row', async () => {
    currentFlags = [
      { key: 'foo', enabled: true, description: 'desc', rollout_pct: null },
      { key: 'bar', enabled: false, description: '', rollout_pct: null },
    ]
    const result = await mod.removePlatformFlagAction({ key: 'foo' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.changed).toBe(true)
      expect(result.flags).toHaveLength(1)
      expect(result.flags[0]?.key).toBe('bar')
    }
    const diff = auditCalls[0]!.before as { removed: string[] }
    expect(diff.removed).toEqual(['foo'])
  })

  it('survives an update failure (returns friendly error)', async () => {
    currentFlags = [
      { key: 'foo', enabled: true, description: '', rollout_pct: null },
    ]
    // Simulate read OK but update failure by switching the single() to fail.
    const originalSingle = fakeSupabase.single
    fakeSupabase.single = async () => ({
      data: null,
      error: { message: 'mocked update failure' },
    })
    try {
      const result = await mod.removePlatformFlagAction({ key: 'foo' })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toMatch(/could not save/i)
      }
    } finally {
      fakeSupabase.single = originalSingle
    }
  })
})