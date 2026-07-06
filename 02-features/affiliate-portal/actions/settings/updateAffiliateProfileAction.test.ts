// updateAffiliateProfileAction.test.ts — P13.11 settings profile action tests.
//
// Coverage:
//   - Auth gating: requireAffiliate() rejects anon / non-affiliate
//   - Zod validation: display_name 2-60 chars, bio ≤ 280
//   - Empty bio normalized to null (matches the customer-side action)
//   - DB update succeeds → revalidatePath called → returns ok
//   - DB error → returns { ok: false, error } (no revalidate)
//   - No-op save (same values) → no audit row
//   - Diff save (one field changed) → audit row with { before, after }
//   - IP + user-agent headers → logged in audit metadata
//   - Field errors: too-short / too-long display_name, too-long bio
//   - Strict mode: extra keys rejected
//   - PII safety: no email in metadata

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
    update: vi.fn(() => builder),
    maybeSingle: vi.fn(() => Promise.resolve({ data: state.data, error: state.error })),
    then: undefined,
  }
  // The UPDATE path resolves immediately (no .select().single() chain).
  builder.update = vi.fn(() => ({
    eq: vi.fn(() => Promise.resolve({ data: null, error: state.error })),
  }))
  // Wrap in a `from()` function so the action can call
  // `supabase.from('profiles')` and get this builder.
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
  return await import('./updateAffiliateProfileAction')
}

const FAKE_USER = { id: 'user-1', email: 'alice@example.com' }

// --- tests ------------------------------------------------------------------

describe('updateAffiliateProfileAction — auth gating', () => {
  it('returns friendly error when requireAffiliate throws', async () => {
    mockRequireAffiliate.mockRejectedValue(new Error('not signed in'))
    const a = await loadAction()
    const out = await a.updateAffiliateProfileAction({
      display_name: 'Alice',
      bio: '',
    })
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.error).toMatch(/sign in/i)
    }
    expect(mockRevalidatePath).not.toHaveBeenCalled()
    expect(mockWriteSelfAuditLog).not.toHaveBeenCalled()
  })
})

describe('updateAffiliateProfileAction — Zod validation', () => {
  it('rejects a too-short display_name (1 char)', async () => {
    mockRequireAffiliate.mockResolvedValue(FAKE_USER)
    const a = await loadAction()
    const out = await a.updateAffiliateProfileAction({
      display_name: 'A',
      bio: '',
    })
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.fieldErrors?.display_name).toBeDefined()
    }
  })

  it('rejects a too-long display_name (61 chars)', async () => {
    mockRequireAffiliate.mockResolvedValue(FAKE_USER)
    const a = await loadAction()
    const out = await a.updateAffiliateProfileAction({
      display_name: 'x'.repeat(61),
      bio: '',
    })
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.fieldErrors?.display_name).toBeDefined()
    }
  })

  it('rejects a too-long bio (281 chars)', async () => {
    mockRequireAffiliate.mockResolvedValue(FAKE_USER)
    const a = await loadAction()
    const out = await a.updateAffiliateProfileAction({
      display_name: 'Alice',
      bio: 'x'.repeat(281),
    })
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.fieldErrors?.bio).toBeDefined()
    }
  })

  it('rejects unknown keys (strict mode)', async () => {
    mockRequireAffiliate.mockResolvedValue(FAKE_USER)
    const a = await loadAction()
    const out = await a.updateAffiliateProfileAction({
      display_name: 'Alice',
      bio: '',
      avatar_url: 'https://x.example.com/avatar.png', // not allowed on affiliate surface
    })
    expect(out.ok).toBe(false)
  })

  it('rejects missing display_name', async () => {
    mockRequireAffiliate.mockResolvedValue(FAKE_USER)
    const a = await loadAction()
    const out = await a.updateAffiliateProfileAction({ bio: '' })
    expect(out.ok).toBe(false)
  })

  it('accepts a 60-char display_name (boundary)', async () => {
    mockRequireAffiliate.mockResolvedValue(FAKE_USER)
    const profileBefore = makeSupabaseBuilder({
      data: { display_name: 'x'.repeat(60), bio: null },
      error: null,
    })
    mockGetServerSupabase.mockResolvedValue(makeFakeSupabase(profileBefore))

    const a = await loadAction()
    const out = await a.updateAffiliateProfileAction({
      display_name: 'x'.repeat(60),
      bio: '',
    })
    expect(out.ok).toBe(true)
  })

  it('accepts a 2-char display_name (boundary)', async () => {
    mockRequireAffiliate.mockResolvedValue(FAKE_USER)
    const profileBefore = makeSupabaseBuilder({
      data: { display_name: 'AB', bio: null },
      error: null,
    })
    mockGetServerSupabase.mockResolvedValue(makeFakeSupabase(profileBefore))

    const a = await loadAction()
    const out = await a.updateAffiliateProfileAction({
      display_name: 'AB',
      bio: '',
    })
    expect(out.ok).toBe(true)
  })

  it('accepts a 280-char bio (boundary)', async () => {
    mockRequireAffiliate.mockResolvedValue(FAKE_USER)
    const profileBefore = makeSupabaseBuilder({
      data: { display_name: 'Alice', bio: 'x'.repeat(280) },
      error: null,
    })
    mockGetServerSupabase.mockResolvedValue(makeFakeSupabase(profileBefore))

    const a = await loadAction()
    const out = await a.updateAffiliateProfileAction({
      display_name: 'Alice',
      bio: 'x'.repeat(280),
    })
    expect(out.ok).toBe(true)
  })
})

describe('updateAffiliateProfileAction — happy path', () => {
  it('updates display_name + bio and writes a diff audit row', async () => {
    mockRequireAffiliate.mockResolvedValue(FAKE_USER)
    mockHdrsGet.mockImplementation((k: string) =>
      k === 'x-forwarded-for' ? '203.0.113.5' : k === 'user-agent' ? 'Mozilla/5.0' : null,
    )
    const profileBefore = makeSupabaseBuilder({
      data: { display_name: 'Old', bio: 'Old bio' },
      error: null,
    })
    mockGetServerSupabase.mockResolvedValue(makeFakeSupabase(profileBefore))

    const a = await loadAction()
    const out = await a.updateAffiliateProfileAction({
      display_name: 'Alice',
      bio: 'New bio',
    })
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.profile.displayName).toBe('Alice')
      expect(out.profile.bio).toBe('New bio')
    }
    expect(mockRevalidatePath).toHaveBeenCalledWith('/affiliate/settings')
    expect(mockRevalidatePath).toHaveBeenCalledWith('/[handle]', 'page')
    expect(mockWriteSelfAuditLog).toHaveBeenCalledTimes(1)
    const auditArgs = mockWriteSelfAuditLog.mock.calls[0]?.[0] as Record<string, unknown>
    expect(auditArgs?.action).toBe('affiliate_settings_self_update')
    expect(auditArgs?.targetKind).toBe('profiles')
    expect(auditArgs?.targetId).toBe('user-1')
    expect(auditArgs?.ipAddress).toBe('203.0.113.5')
    expect(auditArgs?.userAgent).toBe('Mozilla/5.0')
    expect(auditArgs?.metadata).toEqual({
      before: { display_name: 'Old', bio: 'Old bio' },
      after: { display_name: 'Alice', bio: 'New bio' },
    })
  })

  it('normalizes empty bio to null', async () => {
    mockRequireAffiliate.mockResolvedValue(FAKE_USER)
    const profileBefore = makeSupabaseBuilder({
      data: { display_name: 'Alice', bio: 'old' },
      error: null,
    })
    mockGetServerSupabase.mockResolvedValue(makeFakeSupabase(profileBefore))

    const a = await loadAction()
    const out = await a.updateAffiliateProfileAction({
      display_name: 'Alice',
      bio: '',
    })
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.profile.bio).toBeNull()
    }
  })

  it('writes a no-op audit (no metadata) when nothing changed', async () => {
    mockRequireAffiliate.mockResolvedValue(FAKE_USER)
    const profileBefore = makeSupabaseBuilder({
      data: { display_name: 'Alice', bio: 'Same' },
      error: null,
    })
    mockGetServerSupabase.mockResolvedValue(makeFakeSupabase(profileBefore))

    const a = await loadAction()
    const out = await a.updateAffiliateProfileAction({
      display_name: 'Alice',
      bio: 'Same',
    })
    expect(out.ok).toBe(true)
    // No diff → no audit row written.
    expect(mockWriteSelfAuditLog).not.toHaveBeenCalled()
  })

  it('writes a partial diff when only one field changed', async () => {
    mockRequireAffiliate.mockResolvedValue(FAKE_USER)
    const profileBefore = makeSupabaseBuilder({
      data: { display_name: 'Alice', bio: 'Same' },
      error: null,
    })
    mockGetServerSupabase.mockResolvedValue(makeFakeSupabase(profileBefore))

    const a = await loadAction()
    const out = await a.updateAffiliateProfileAction({
      display_name: 'Alice Updated',
      bio: 'Same',
    })
    expect(out.ok).toBe(true)
    expect(mockWriteSelfAuditLog).toHaveBeenCalledTimes(1)
    const auditArgs = mockWriteSelfAuditLog.mock.calls[0]?.[0] as Record<string, unknown>
    const metadata = auditArgs?.metadata as { before: Record<string, unknown>; after: Record<string, unknown> }
    expect(metadata?.before).toEqual({ display_name: 'Alice' })
    expect(metadata?.after).toEqual({ display_name: 'Alice Updated' })
  })

  it('returns ok=false when the DB update errors', async () => {
    mockRequireAffiliate.mockResolvedValue(FAKE_USER)
    const profileBefore = makeSupabaseBuilder({
      data: { display_name: 'Old', bio: null },
      error: null,
    })
    profileBefore.state.data = null
    profileBefore.state.error = { code: 'PGRST500', message: 'db down' }
    mockGetServerSupabase.mockResolvedValue(makeFakeSupabase(profileBefore))

    const a = await loadAction()
    const out = await a.updateAffiliateProfileAction({
      display_name: 'Alice',
      bio: '',
    })
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.error).toMatch(/try again/i)
    }
    expect(mockRevalidatePath).not.toHaveBeenCalled()
    expect(mockWriteSelfAuditLog).not.toHaveBeenCalled()
  })

  it('handles a missing profile row gracefully (null before) — still updates', async () => {
    mockRequireAffiliate.mockResolvedValue(FAKE_USER)
    const profileBefore = makeSupabaseBuilder({
      data: null,
      error: null,
    })
    mockGetServerSupabase.mockResolvedValue(makeFakeSupabase(profileBefore))

    const a = await loadAction()
    const out = await a.updateAffiliateProfileAction({
      display_name: 'Alice',
      bio: '',
    })
    expect(out.ok).toBe(true)
    // All fields are "changed" (null → Alice) → audit row written.
    expect(mockWriteSelfAuditLog).toHaveBeenCalledTimes(1)
  })
})

describe('updateAffiliateProfileAction — PII safety', () => {
  it('never includes the user email in the audit metadata JSON', async () => {
    mockRequireAffiliate.mockResolvedValue(FAKE_USER)
    const profileBefore = makeSupabaseBuilder({
      data: { display_name: 'Old', bio: 'old' },
      error: null,
    })
    mockGetServerSupabase.mockResolvedValue(makeFakeSupabase(profileBefore))

    const a = await loadAction()
    await a.updateAffiliateProfileAction({
      display_name: 'Alice',
      bio: 'new',
    })
    const auditArgs = mockWriteSelfAuditLog.mock.calls[0]?.[0] as Record<string, unknown>
    // The userEmail IS passed (writeSelfAuditLog writes it to the
    // actor_email column) — the PII-safety contract is that the
    // email does NOT appear in the metadata JSON (the { before,
    // after } diff).
    const metadata = auditArgs?.metadata as Record<string, unknown>
    const metadataStr = JSON.stringify(metadata)
    expect(metadataStr).not.toContain('alice@example.com')
    expect(metadataStr).not.toContain('alice@')
  })

  it('uses the session user_id as both actor_id and target_id', async () => {
    mockRequireAffiliate.mockResolvedValue(FAKE_USER)
    const profileBefore = makeSupabaseBuilder({
      data: { display_name: 'Old', bio: null },
      error: null,
    })
    mockGetServerSupabase.mockResolvedValue(makeFakeSupabase(profileBefore))

    const a = await loadAction()
    await a.updateAffiliateProfileAction({
      display_name: 'Alice',
      bio: '',
    })
    const auditArgs = mockWriteSelfAuditLog.mock.calls[0]?.[0] as Record<string, unknown>
    expect(auditArgs?.userId).toBe('user-1')
    expect(auditArgs?.targetId).toBe('user-1')
  })
})