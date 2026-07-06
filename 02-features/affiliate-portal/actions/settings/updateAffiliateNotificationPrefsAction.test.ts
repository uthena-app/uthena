// updateAffiliateNotificationPrefsAction.test.ts — P13.11 settings prefs action tests.
//
// Coverage:
//   - Auth gating
//   - Zod validation (strict subset, refine rejects empty patch)
//   - Single-toggle patch → only that column changed in audit
//   - Multi-toggle patch → all changed columns in audit
//   - No-op (no toggles changed) → no audit row
//   - First-write (no existing row) → UPSERT succeeds, audit diff uses defaults
//   - DB error → friendly error, no revalidate, no audit
//   - Revalidate path called on success
//   - The 4 toggles correctly defaulted in the response

import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- mocks -----------------------------------------------------------------

const mockRequireAffiliate = vi.fn()
const mockRevalidatePath = vi.fn()
const mockWriteSelfAuditLog = vi.fn()
const mockHdrsGet = vi.fn()

vi.mock('@foundations/auth/guards', () => ({
  requireAffiliate: () => mockRequireAffiliate(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}))

vi.mock('next/headers', () => ({
  headers: () => ({
    get: (k: string) => mockHdrsGet(k),
  }),
}))

vi.mock('@features/account/profile/actions/writeSelfAuditLog', () => ({
  writeSelfAuditLog: (...args: unknown[]) => mockWriteSelfAuditLog(...args),
}))

function makeSupabaseBuilder(initial: {
  data: unknown
  error: unknown
} = { data: null, error: null }) {
  const state: { data: unknown; error: unknown } = { ...initial }
  const builder: Record<string, unknown> = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    upsert: vi.fn(() => ({
      // The upsert resolves immediately
      // (matches Supabase's behavior on `.upsert(...)`).
    })),
    maybeSingle: vi.fn(() => Promise.resolve({ data: state.data, error: state.error })),
  }
  // Capture the upsert call's resolved value.
  builder.upsert = vi.fn(() => Promise.resolve({ data: null, error: state.error }))
  const from = vi.fn(() => builder)
  return { builder, state, from }
}

function makeFakeSupabase(client: { from: ReturnType<typeof vi.fn> }) {
  return client
}

const mockGetServerSupabase = vi.fn()

vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: () => mockGetServerSupabase(),
}))

vi.mock('@foundations/log/pino', () => ({
  loggerFor: () => ({ warn: vi.fn() }),
}))

beforeEach(() => {
  vi.resetModules()
  mockRequireAffiliate.mockReset()
  mockRevalidatePath.mockReset()
  mockWriteSelfAuditLog.mockReset()
  mockHdrsGet.mockReset()
  mockGetServerSupabase.mockReset()
  mockHdrsGet.mockImplementation(() => null)
})

async function loadAction() {
  return await import('./updateAffiliateNotificationPrefsAction')
}

const FAKE_USER = { id: 'user-1', email: 'alice@example.com' }

// --- tests ------------------------------------------------------------------

describe('updateAffiliateNotificationPrefsAction — auth gating', () => {
  it('returns friendly error when requireAffiliate throws', async () => {
    mockRequireAffiliate.mockRejectedValue(new Error('not signed in'))
    const a = await loadAction()
    const out = await a.updateAffiliateNotificationPrefsAction({
      affiliate_updates_opt_in: true,
    })
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.error).toMatch(/sign in/i)
    }
    expect(mockRevalidatePath).not.toHaveBeenCalled()
    expect(mockWriteSelfAuditLog).not.toHaveBeenCalled()
  })
})

describe('updateAffiliateNotificationPrefsAction — Zod validation', () => {
  it('rejects an empty patch (no fields)', async () => {
    mockRequireAffiliate.mockResolvedValue(FAKE_USER)
    const a = await loadAction()
    const out = await a.updateAffiliateNotificationPrefsAction({})
    expect(out.ok).toBe(false)
  })

  it('rejects unknown keys (strict mode)', async () => {
    mockRequireAffiliate.mockResolvedValue(FAKE_USER)
    const a = await loadAction()
    const out = await a.updateAffiliateNotificationPrefsAction({
      marketing_opt_in: true, // not in the affiliate subset
    } as unknown as object)
    expect(out.ok).toBe(false)
  })

  it('rejects non-boolean values', async () => {
    mockRequireAffiliate.mockResolvedValue(FAKE_USER)
    const a = await loadAction()
    const out = await a.updateAffiliateNotificationPrefsAction({
      affiliate_updates_opt_in: 'yes' as unknown as boolean,
    })
    expect(out.ok).toBe(false)
  })
})

describe('updateAffiliateNotificationPrefsAction — happy path', () => {
  it('single-toggle patch writes a diff audit row with the single field', async () => {
    mockRequireAffiliate.mockResolvedValue(FAKE_USER)
    const prefs = makeSupabaseBuilder({
      data: {
        affiliate_updates_opt_in: false,
        commission_notifications_opt_in: true,
        payout_notifications_opt_in: true,
        monthly_digest_opt_in: true,
      },
      error: null,
    })
    mockGetServerSupabase.mockResolvedValue(makeFakeSupabase(prefs))

    const a = await loadAction()
    const out = await a.updateAffiliateNotificationPrefsAction({
      affiliate_updates_opt_in: true,
    })
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.prefs.affiliateUpdatesOptIn).toBe(true)
      // Defaults preserved
      expect(out.prefs.commissionNotificationsOptIn).toBe(true)
      expect(out.prefs.payoutNotificationsOptIn).toBe(true)
      expect(out.prefs.monthlyDigestOptIn).toBe(true)
    }
    expect(mockRevalidatePath).toHaveBeenCalledWith('/affiliate/settings')
    expect(mockWriteSelfAuditLog).toHaveBeenCalledTimes(1)
    const auditArgs = mockWriteSelfAuditLog.mock.calls[0]?.[0] as Record<string, unknown>
    expect(auditArgs?.action).toBe('affiliate_settings_self_update')
    expect(auditArgs?.targetKind).toBe('notification_preferences')
    const metadata = auditArgs?.metadata as { before: Record<string, unknown>; after: Record<string, unknown> }
    expect(metadata?.before).toEqual({ affiliateUpdatesOptIn: false })
    expect(metadata?.after).toEqual({ affiliateUpdatesOptIn: true })
  })

  it('multi-toggle patch writes a multi-field diff audit row', async () => {
    mockRequireAffiliate.mockResolvedValue(FAKE_USER)
    const prefs = makeSupabaseBuilder({
      data: {
        affiliate_updates_opt_in: true,
        commission_notifications_opt_in: true,
        payout_notifications_opt_in: true,
        monthly_digest_opt_in: true,
      },
      error: null,
    })
    mockGetServerSupabase.mockResolvedValue(makeFakeSupabase(prefs))

    const a = await loadAction()
    const out = await a.updateAffiliateNotificationPrefsAction({
      affiliate_updates_opt_in: false,
      monthly_digest_opt_in: false,
    })
    expect(out.ok).toBe(true)
    expect(mockWriteSelfAuditLog).toHaveBeenCalledTimes(1)
    const auditArgs = mockWriteSelfAuditLog.mock.calls[0]?.[0] as Record<string, unknown>
    const metadata = auditArgs?.metadata as { before: Record<string, unknown>; after: Record<string, unknown> }
    expect(metadata?.before).toEqual({
      affiliateUpdatesOptIn: true,
      monthlyDigestOptIn: true,
    })
    expect(metadata?.after).toEqual({
      affiliateUpdatesOptIn: false,
      monthlyDigestOptIn: false,
    })
  })

  it('no-op save (same values) writes no audit row', async () => {
    mockRequireAffiliate.mockResolvedValue(FAKE_USER)
    const prefs = makeSupabaseBuilder({
      data: {
        affiliate_updates_opt_in: false,
        commission_notifications_opt_in: true,
        payout_notifications_opt_in: true,
        monthly_digest_opt_in: true,
      },
      error: null,
    })
    mockGetServerSupabase.mockResolvedValue(makeFakeSupabase(prefs))

    const a = await loadAction()
    const out = await a.updateAffiliateNotificationPrefsAction({
      affiliate_updates_opt_in: false, // already false
      commission_notifications_opt_in: true, // already true
    })
    expect(out.ok).toBe(true)
    expect(mockWriteSelfAuditLog).not.toHaveBeenCalled()
  })

  it('first-write (no existing row) → UPSERT succeeds, audit uses defaults for before', async () => {
    mockRequireAffiliate.mockResolvedValue(FAKE_USER)
    const prefs = makeSupabaseBuilder({
      data: null,
      error: null,
    })
    mockGetServerSupabase.mockResolvedValue(makeFakeSupabase(prefs))

    const a = await loadAction()
    const out = await a.updateAffiliateNotificationPrefsAction({
      affiliate_updates_opt_in: true,
    })
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.prefs.affiliateUpdatesOptIn).toBe(true)
      // Default values applied to the other 3 (from the spec).
      expect(out.prefs.commissionNotificationsOptIn).toBe(true)
      expect(out.prefs.payoutNotificationsOptIn).toBe(true)
      expect(out.prefs.monthlyDigestOptIn).toBe(true)
    }
    expect(mockWriteSelfAuditLog).toHaveBeenCalledTimes(1)
    const auditArgs = mockWriteSelfAuditLog.mock.calls[0]?.[0] as Record<string, unknown>
    const metadata = auditArgs?.metadata as { before: Record<string, unknown>; after: Record<string, unknown> }
    // before = null (no prior row) for the patched field.
    expect(metadata?.before).toEqual({ affiliateUpdatesOptIn: null })
    expect(metadata?.after).toEqual({ affiliateUpdatesOptIn: true })
  })

  it('returns ok=false when the DB upsert errors', async () => {
    mockRequireAffiliate.mockResolvedValue(FAKE_USER)
    const prefs = makeSupabaseBuilder({
      data: null,
      error: null,
    })
    prefs.state.error = { code: 'PGRST500', message: 'db down' }
    mockGetServerSupabase.mockResolvedValue(makeFakeSupabase(prefs))

    const a = await loadAction()
    const out = await a.updateAffiliateNotificationPrefsAction({
      affiliate_updates_opt_in: true,
    })
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.error).toMatch(/try again/i)
    }
    expect(mockRevalidatePath).not.toHaveBeenCalled()
    expect(mockWriteSelfAuditLog).not.toHaveBeenCalled()
  })
})

describe('updateAffiliateNotificationPrefsAction — PII safety', () => {
  it('never includes the user email in the audit metadata JSON', async () => {
    mockRequireAffiliate.mockResolvedValue(FAKE_USER)
    const prefs = makeSupabaseBuilder({
      data: {
        affiliate_updates_opt_in: false,
        commission_notifications_opt_in: true,
        payout_notifications_opt_in: true,
        monthly_digest_opt_in: true,
      },
      error: null,
    })
    mockGetServerSupabase.mockResolvedValue(makeFakeSupabase(prefs))

    const a = await loadAction()
    await a.updateAffiliateNotificationPrefsAction({
      affiliate_updates_opt_in: true,
    })
    const auditArgs = mockWriteSelfAuditLog.mock.calls[0]?.[0] as Record<string, unknown>
    const metadata = auditArgs?.metadata as Record<string, unknown>
    const metadataStr = JSON.stringify(metadata)
    expect(metadataStr).not.toContain('alice@example.com')
  })
})