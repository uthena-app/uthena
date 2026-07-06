// updateDmcaAgent.test.ts — unit tests for the admin DMCA agent
// update server action.
//
// Covers:
//   - happy path: valid input → upsert + audit log written
//   - field validation: Zod errors surface as `fieldErrors`
//   - auth gate: non-admin caller → ok:false (the action also relies
//     on the page route's requireRole for redirect; the action's own
//     gate returns the typed error)
//   - pre-read failure → friendly message, no upsert
//   - upsert failure → friendly message, no audit log
//   - audit log failure → save still succeeds (fail-soft)
//   - revalidatePath called for /dmca + /admin/dmca-agent on success
//   - defensive: empty before is serialized as null in the metadata
//   - PII safety: actor_email is the admin's email (we trust the
//     requireRole gate); the agent contact itself is non-PII per
//     § 512(c) — it's the legally-required public contact.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Mocks --------------------------------------------------------------

// Mock requireRole so we can drive the auth gate.
const mockRequireRole = vi.fn()
vi.mock('@foundations/auth/guards', () => ({
  requireRole: (...args: unknown[]) => mockRequireRole(...args),
}))

// Mock the supabase server + service-role clients.
// We split the read chain (existing row) from the write chain
// (upsert) because the action calls `from('app_settings')` twice.
const mockUpsertSingle = vi.fn()
const mockUpsertSelect = vi.fn(() => ({ single: mockUpsertSingle }))
const mockUpsert = vi.fn(() => ({ select: mockUpsertSelect }))

const mockExistingMaybeSingle = vi.fn()
const mockExistingEq = vi.fn(() => ({ maybeSingle: mockExistingMaybeSingle }))
const mockExistingSelect = vi.fn(() => ({ eq: mockExistingEq }))

// The `from` function dispatches to either the read or write chain
// depending on the call order — each call returns a different chain
// shape, so we track a per-call counter and route accordingly.
let fromCallCount = 0
const mockFrom = vi.fn((_table: string) => {
  fromCallCount += 1
  // 1st call: pre-read (existing row, .select().eq().maybeSingle()).
  // 2nd call: upsert (.upsert().select().single()).
  if (fromCallCount % 2 === 1) {
    return { select: mockExistingSelect }
  }
  return { upsert: mockUpsert }
})

const mockGetServerSupabase = vi.fn(async () => ({ from: mockFrom }))
const mockGetServiceSupabase = vi.fn(() => ({ from: mockFrom }))

vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: () => mockGetServerSupabase(),
  getServiceSupabase: () => mockGetServiceSupabase(),
}))

// Mock headers() so the audit log writer gets a stable IP / UA.
vi.mock('next/headers', () => ({
  headers: async () => ({
    get: (k: string) => {
      if (k === 'x-forwarded-for') return '203.0.113.42'
      if (k === 'user-agent') return 'vitest/1.0'
      return null
    },
  }),
}))

// Mock revalidatePath so we can assert on it without a Next.js runtime.
const mockRevalidatePath = vi.fn()
vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}))

// Mock the audit log writer so we can assert on its inputs without
// touching the real DB.
const mockWriteAudit = vi.fn()
vi.mock('./writePlatformSettingsAuditLog', () => ({
  writePlatformSettingsAuditLog: (...args: unknown[]) => mockWriteAudit(...args),
}))

// Suppress logger output during tests.
vi.mock('@foundations/log/pino', () => ({
  loggerFor: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

// --- Imports (after mocks) ----------------------------------------------

import { updateDmcaAgentAction } from './updateDmcaAgent'

// --- Test setup ---------------------------------------------------------

beforeEach(() => {
  fromCallCount = 0
  // mockClear (not mockReset) — we keep the chain implementations
  // wired so the typed-chained query builders still work after each
  // test. mockReset would strip the implementations.
  mockUpsertSingle.mockClear()
  mockUpsertSelect.mockClear()
  mockUpsert.mockClear()
  mockExistingMaybeSingle.mockClear()
  mockExistingEq.mockClear()
  mockExistingSelect.mockClear()
  mockFrom.mockClear()
  mockRequireRole.mockReset()
  mockRevalidatePath.mockReset()
  mockWriteAudit.mockReset()
})

function chainForReadThenWrite(readResult: unknown) {
  // First .from('app_settings') → existing row read.
  // Second .from('app_settings') → upsert.
  mockExistingMaybeSingle.mockResolvedValueOnce(readResult)
}

function setAuthAs(admin: { id: string; email: string; role: 'admin' | 'super_admin' }) {
  mockRequireRole.mockResolvedValueOnce(admin as never)
}

function setAuthRefused() {
  // requireRole normally redirects on miss; emulate by returning null.
  mockRequireRole.mockResolvedValueOnce(null as never)
}

// --- Tests --------------------------------------------------------------

describe('updateDmcaAgentAction', () => {
  it('rejects input missing required fields', async () => {
    setAuthAs({ id: 'admin-1', email: 'admin@uthena.com', role: 'admin' })
    const res = await updateDmcaAgentAction({
      name: '',
      email: '',
      mailing_address: '',
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toBe('Please fix the errors below.')
    expect(res.fieldErrors).toBeDefined()
    expect(res.fieldErrors?.name).toBeDefined()
    expect(res.fieldErrors?.email).toBeDefined()
    expect(res.fieldErrors?.mailing_address).toBeDefined()
    // No DB calls on validation failure.
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('rejects an invalid email', async () => {
    setAuthAs({ id: 'admin-1', email: 'admin@uthena.com', role: 'admin' })
    const res = await updateDmcaAgentAction({
      name: 'DMCA Agent',
      email: 'not-an-email',
      mailing_address: '123 Main St, City, State 00000',
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.fieldErrors?.email).toBeDefined()
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('rejects an oversized mailing_address', async () => {
    setAuthAs({ id: 'admin-1', email: 'admin@uthena.com', role: 'admin' })
    const longAddr = 'x'.repeat(501)
    const res = await updateDmcaAgentAction({
      name: 'DMCA Agent',
      email: 'legal@uthena.com',
      mailing_address: longAddr,
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.fieldErrors?.mailing_address).toBeDefined()
  })

  it('trims whitespace from each field before validation + storage', async () => {
    setAuthAs({ id: 'admin-1', email: 'admin@uthena.com', role: 'admin' })
    chainForReadThenWrite({ data: null, error: null })
    mockUpsertSingle.mockResolvedValueOnce({
      data: { updated_at: '2026-06-29T10:00:00Z' },
      error: null,
    })

    const res = await updateDmcaAgentAction({
      name: '  Jane Doe  ',
      email: '  legal@uthena.com  ',
      mailing_address: '  123 Main St  ',
      phone: '  +1-555-0100  ',
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.updatedAt).toBe('2026-06-29T10:00:00Z')

    // The upsert payload must have the trimmed values.
    const upsertCalls = mockUpsert.mock.calls as unknown as Array<[unknown]>
    const upsertArg = upsertCalls[0]?.[0] as {
      value: { name: string; email: string; mailing_address: string; phone: string }
    }
    expect(upsertArg.value).toEqual({
      name: 'Jane Doe',
      email: 'legal@uthena.com',
      mailing_address: '123 Main St',
      phone: '+1-555-0100',
    })
  })

  it('treats an empty phone as the empty string', async () => {
    setAuthAs({ id: 'admin-1', email: 'admin@uthena.com', role: 'admin' })
    chainForReadThenWrite({ data: null, error: null })
    mockUpsertSingle.mockResolvedValueOnce({
      data: { updated_at: '2026-06-29T10:00:00Z' },
      error: null,
    })

    const res = await updateDmcaAgentAction({
      name: 'Jane Doe',
      email: 'legal@uthena.com',
      mailing_address: '123 Main St',
      phone: '',
    })
    expect(res.ok).toBe(true)

    const upsertCalls = mockUpsert.mock.calls as unknown as Array<[unknown]>
    const upsertArg = upsertCalls[0]?.[0] as {
      value: { phone: string }
    }
    expect(upsertArg.value.phone).toBe('')
  })

  it('happy path: upserts + writes audit + revalidates /dmca + /admin/dmca-agent', async () => {
    setAuthAs({ id: 'admin-1', email: 'admin@uthena.com', role: 'admin' })
    // Pre-read returns the seed row (admin should see the diff).
    chainForReadThenWrite({
      data: {
        value: {
          name: 'DMCA Agent, Uthena',
          email: 'legal@uthena.com',
          mailing_address: 'Old address',
          phone: '',
        },
      },
      error: null,
    })
    mockUpsertSingle.mockResolvedValueOnce({
      data: { updated_at: '2026-06-29T10:00:00Z' },
      error: null,
    })

    const res = await updateDmcaAgentAction({
      name: 'Jane Doe, Esq.',
      email: 'legal@uthena.com',
      mailing_address: '123 Main St, City, State 00000',
      phone: '+1-555-0100',
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return

    // The pre-read targeted 'dmca_agent'.
    expect(mockExistingEq).toHaveBeenCalledWith('key', 'dmca_agent')
    // The upsert targeted 'dmca_agent' with onConflict 'key'.
    expect(mockUpsert).toHaveBeenCalledTimes(1)
    const upsertCalls = mockUpsert.mock.calls as unknown as Array<[unknown, unknown]>
    expect(upsertCalls[0]?.[1]).toEqual({ onConflict: 'key' })

    // Audit log gets before/after.
    expect(mockWriteAudit).toHaveBeenCalledTimes(1)
    const auditArg = mockWriteAudit.mock.calls[0]?.[0] as {
      adminId: string
      actorEmail: string
      key: string
      before: unknown
      after: unknown
      ipAddress: string | null
      userAgent: string | null
    }
    expect(auditArg.adminId).toBe('admin-1')
    expect(auditArg.actorEmail).toBe('admin@uthena.com')
    expect(auditArg.key).toBe('dmca_agent')
    expect(auditArg.before).toEqual({
      name: 'DMCA Agent, Uthena',
      email: 'legal@uthena.com',
      mailing_address: 'Old address',
      phone: '',
    })
    expect(auditArg.after).toEqual({
      name: 'Jane Doe, Esq.',
      email: 'legal@uthena.com',
      mailing_address: '123 Main St, City, State 00000',
      phone: '+1-555-0100',
    })
    expect(auditArg.ipAddress).toBe('203.0.113.42')
    expect(auditArg.userAgent).toBe('vitest/1.0')

    // revalidatePath hits both surfaces.
    expect(mockRevalidatePath).toHaveBeenCalledWith('/dmca')
    expect(mockRevalidatePath).toHaveBeenCalledWith('/admin/dmca-agent')
  })

  it('when no prior row exists, audit before is null', async () => {
    setAuthAs({ id: 'admin-1', email: 'admin@uthena.com', role: 'admin' })
    chainForReadThenWrite({ data: null, error: null })
    mockUpsertSingle.mockResolvedValueOnce({
      data: { updated_at: '2026-06-29T10:00:00Z' },
      error: null,
    })

    const res = await updateDmcaAgentAction({
      name: 'Jane Doe',
      email: 'legal@uthena.com',
      mailing_address: '123 Main St',
    })
    expect(res.ok).toBe(true)

    const auditArg = mockWriteAudit.mock.calls[0]?.[0] as { before: unknown }
    expect(auditArg.before).toBeNull()
  })

  it('returns a friendly error when the pre-read fails', async () => {
    setAuthAs({ id: 'admin-1', email: 'admin@uthena.com', role: 'admin' })
    mockExistingMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: 'connection lost' },
    })

    const res = await updateDmcaAgentAction({
      name: 'Jane Doe',
      email: 'legal@uthena.com',
      mailing_address: '123 Main St',
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toMatch(/Could not read the current agent contact/i)
    expect(mockUpsert).not.toHaveBeenCalled()
    expect(mockWriteAudit).not.toHaveBeenCalled()
  })

  it('returns a friendly error when the upsert fails', async () => {
    setAuthAs({ id: 'admin-1', email: 'admin@uthena.com', role: 'admin' })
    chainForReadThenWrite({ data: null, error: null })
    mockUpsertSingle.mockResolvedValueOnce({
      data: null,
      error: { message: 'duplicate key' },
    })

    const res = await updateDmcaAgentAction({
      name: 'Jane Doe',
      email: 'legal@uthena.com',
      mailing_address: '123 Main St',
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toMatch(/Could not save the agent contact/i)
    expect(mockWriteAudit).not.toHaveBeenCalled()
  })

  it('still succeeds when the audit log writer fails (fail-soft)', async () => {
    setAuthAs({ id: 'admin-1', email: 'admin@uthena.com', role: 'admin' })
    chainForReadThenWrite({ data: null, error: null })
    mockUpsertSingle.mockResolvedValueOnce({
      data: { updated_at: '2026-06-29T10:00:00Z' },
      error: null,
    })
    mockWriteAudit.mockResolvedValueOnce(null) // simulated write failure

    const res = await updateDmcaAgentAction({
      name: 'Jane Doe',
      email: 'legal@uthena.com',
      mailing_address: '123 Main St',
    })
    // Save itself still succeeds.
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.updatedAt).toBe('2026-06-29T10:00:00Z')
    // And revalidatePath still fires.
    expect(mockRevalidatePath).toHaveBeenCalledWith('/dmca')
    expect(mockRevalidatePath).toHaveBeenCalledWith('/admin/dmca-agent')
  })

  it('refuses non-admin callers', async () => {
    setAuthRefused()
    const res = await updateDmcaAgentAction({
      name: 'Jane Doe',
      email: 'legal@uthena.com',
      mailing_address: '123 Main St',
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toMatch(/not authorized/i)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('accepts FormData as well as plain object', async () => {
    setAuthAs({ id: 'admin-1', email: 'admin@uthena.com', role: 'admin' })
    chainForReadThenWrite({ data: null, error: null })
    mockUpsertSingle.mockResolvedValueOnce({
      data: { updated_at: '2026-06-29T10:00:00Z' },
      error: null,
    })

    const fd = new FormData()
    fd.set('name', 'Jane Doe')
    fd.set('email', 'legal@uthena.com')
    fd.set('mailing_address', '123 Main St')
    fd.set('phone', '')

    const res = await updateDmcaAgentAction(fd)
    expect(res.ok).toBe(true)
  })
})