// Unit tests for updatePartnerSettingsAction — P12.17 surface
// (social_links Zod validation + is_public toggle + compact-storage
// behavior + audit-log diff coverage for the new fields).
//
// We mock `getServerSupabase` + `writeSelfAuditLog` + `revalidatePath`
// + the encryption module so the tests run as pure logic (no DB, no
// real encryption, no Next cache writes). Mocks are reset between
// tests via vi.clearAllMocks in afterEach.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetServerSupabase = vi.fn()
const mockWriteSelfAuditLog = vi.fn()
const mockRevalidatePath = vi.fn()
const mockEncryptString = vi.fn()

vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: () => mockGetServerSupabase(),
}))
vi.mock('@features/account/profile/actions/writeSelfAuditLog', () => ({
  writeSelfAuditLog: (input: unknown) => mockWriteSelfAuditLog(input),
}))
vi.mock('next/cache', () => ({
  revalidatePath: (p: string) => mockRevalidatePath(p),
}))
vi.mock('@foundations/security/encryption', () => ({
  encryptString: (s: string) => mockEncryptString(s),
  isEncryptedEnvelope: () => false,
  decryptStringOrPassThrough: (s: unknown) => (typeof s === 'string' ? s : null),
}))

// Re-import after mocks so the action module picks up the mocked deps.
const { updatePartnerSettingsAction } = await import('./updatePartnerSettings')

// Email construction helpers — the file-write pipeline obfuscates
// literal email strings (e.g. 'partner@…' → '[email protected]') which
// makes them invalid for Zod's `.email()` validator. Building the
// strings at runtime bypasses the obfuscation.
const E = (local: string, domain: string) => `${local}@${domain}`

type ServerCall = {
  method: 'from' | 'select' | 'eq' | 'update' | 'maybeSingle' | 'single'
  payload?: unknown
  table?: string
  col?: string
  val?: unknown
}
const serverCalls: ServerCall[] = []
const serverResponses: Array<{ data: unknown; error: unknown }> = []

function pushResponse(data: unknown, error: unknown = null) {
  serverResponses.push({ data, error })
}

function buildSupabaseMock({
  user = { id: 'user-1', email: '[email protected]' },
  snapshot = {
    id: 42,
    bio: '',
    website_url: null,
    tax_country: 'US',
    tax_id: null,
    payout_method: null,
    social_links: {},
    is_public: false,
  },
  updateError = null,
}: {
  user?: { id: string; email: string } | null
  snapshot?: Record<string, unknown> | null
  updateError?: { message: string; code?: string } | null
} = {}) {
  // The update chain returns a thenable promise that resolves to
  // { data: null, error: updateError } on every `.update(...).eq(...)`
  // invocation. The snapshot read uses `.select(...).eq(...).maybeSingle()`
  // and consumes from `serverResponses` (or falls back to `snapshot`).
  const updateThenable = Promise.resolve({ data: null, error: updateError })
  return {
    auth: { getUser: async () => ({ data: { user } }) },
    from: (table: string) => {
      serverCalls.push({ method: 'from', table })
      const chain = {
        select(payload: unknown) {
          serverCalls.push({ method: 'select', payload })
          return chain
        },
        update(payload: unknown) {
          serverCalls.push({ method: 'update', payload })
          return chain
        },
        eq(_col: string, _val: unknown) {
          serverCalls.push({ method: 'eq' })
          return chain
        },
        maybeSingle: vi.fn(async () => {
          serverCalls.push({ method: 'maybeSingle' })
          if (snapshot === null) {
            return { data: null, error: null }
          }
          const next = serverResponses.shift() ?? { data: snapshot, error: null }
          return next
        }),
        single: vi.fn(async () => {
          serverCalls.push({ method: 'single' })
          const next = serverResponses.shift() ?? { data: snapshot, error: null }
          return next
        }),
        // The final awaited chain — return a fresh promise for each
        // call (some tests assert the update is called once and we
        // don't want shared state across calls).
      }
      // Make the chain awaitable directly so `await supabase.from(t).update(u).eq(c, v)` works.
      ;(chain as unknown as Promise<{ data: null; error: typeof updateError }>).then = ((
        r: (v: { data: null; error: typeof updateError }) => unknown,
      ) => updateThenable.then(r)) as never
      return chain
    },
  }
}

beforeEach(() => {
  serverCalls.length = 0
  serverResponses.length = 0
  mockGetServerSupabase.mockReset()
  mockWriteSelfAuditLog.mockReset()
  mockRevalidatePath.mockReset()
  mockEncryptString.mockReset()
  mockEncryptString.mockImplementation((s: string) => `encrypted(${s})`)
  mockWriteSelfAuditLog.mockResolvedValue(99)
  mockRevalidatePath.mockImplementation(() => {})
})

afterEach(() => {
  vi.clearAllMocks()
})

// ===================================================================
// P12.17 — social_links Zod validation
// ===================================================================

describe('updatePartnerSettingsAction — P12.17 social_links validation', () => {
  it('accepts a fully-populated social_links payload', async () => {
    mockGetServerSupabase.mockResolvedValue(buildSupabaseMock())
    pushResponse({ id: 42, bio: null, website_url: null, tax_country: 'US', tax_id: null, payout_method: null, social_links: {}, is_public: false })

    const result = await updatePartnerSettingsAction({
      social_links: {
        twitter: '@coolpartner',
        linkedin: 'cool-partner',
        youtube: '@coolpartner',
        github: 'coolpartner',
        website: 'https://coolpartner.example.com',
      },
    })

    expect(result.ok).toBe(true)
    // Compact: the DB update payload should contain all 5 fields.
    const updateCall = serverCalls.find((c) => c.method === 'update')
    expect(updateCall?.payload).toMatchObject({
      social_links: {
        twitter: '@coolpartner',
        linkedin: 'cool-partner',
        youtube: '@coolpartner',
        github: 'coolpartner',
        website: 'https://coolpartner.example.com',
      },
    })
  })

  it('accepts empty strings (compacts to {} on write)', async () => {
    mockGetServerSupabase.mockResolvedValue(buildSupabaseMock())
    pushResponse({ id: 42, bio: null, website_url: null, tax_country: 'US', tax_id: null, payout_method: null, social_links: {}, is_public: false })

    const result = await updatePartnerSettingsAction({
      social_links: { twitter: '', linkedin: '', youtube: '', github: '', website: '' },
    })

    expect(result.ok).toBe(true)
    const updateCall = serverCalls.find((c) => c.method === 'update')
    expect(updateCall?.payload).toMatchObject({ social_links: {} })
  })

  it('rejects a Twitter handle longer than 15 chars', async () => {
    mockGetServerSupabase.mockResolvedValue(buildSupabaseMock())
    pushResponse({ id: 42, social_links: {}, is_public: false })

    const result = await updatePartnerSettingsAction({
      social_links: { twitter: 'a'.repeat(20), linkedin: '', youtube: '', github: '', website: '' },
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.fieldErrors?.['social_links.twitter']).toMatch(/1-15/)
    }
  })

  it('rejects a Twitter handle with invalid characters', async () => {
    mockGetServerSupabase.mockResolvedValue(buildSupabaseMock())
    pushResponse({ id: 42, social_links: {}, is_public: false })

    const result = await updatePartnerSettingsAction({
      social_links: { twitter: 'has spaces!', linkedin: '', youtube: '', github: '', website: '' },
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.fieldErrors?.['social_links.twitter']).toBeTruthy()
    }
  })

  it('rejects a GitHub handle with invalid characters', async () => {
    mockGetServerSupabase.mockResolvedValue(buildSupabaseMock())
    pushResponse({ id: 42, social_links: {}, is_public: false })

    const result = await updatePartnerSettingsAction({
      social_links: { twitter: '', linkedin: '', youtube: '', github: 'has spaces', website: '' },
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.fieldErrors?.['social_links.github']).toMatch(/1-39/)
    }
  })

  it('rejects a website URL that is not http/https', async () => {
    mockGetServerSupabase.mockResolvedValue(buildSupabaseMock())
    pushResponse({ id: 42, social_links: {}, is_public: false })

    const result = await updatePartnerSettingsAction({
      social_links: {
        twitter: '',
        linkedin: '',
        youtube: '',
        github: '',
        website: 'javascript:alert(1)',
      },
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.fieldErrors?.['social_links.website']).toBeTruthy()
    }
  })

  it('rejects unknown keys in social_links (.strict())', async () => {
    mockGetServerSupabase.mockResolvedValue(buildSupabaseMock())
    pushResponse({ id: 42, social_links: {}, is_public: false })

    const result = await updatePartnerSettingsAction({
      social_links: { twitter: '', linkedin: '', youtube: '', github: '', website: '', tiktok: '@evil' } as unknown as {
        twitter: string; linkedin: string; youtube: string; github: string; website: string
      },
    })

    expect(result.ok).toBe(false)
  })

  it('omits empty fields when compacting to DB (only stores set fields)', async () => {
    mockGetServerSupabase.mockResolvedValue(buildSupabaseMock())
    pushResponse({ id: 42, bio: null, website_url: null, tax_country: 'US', tax_id: null, payout_method: null, social_links: {}, is_public: false })

    const result = await updatePartnerSettingsAction({
      social_links: { twitter: '@onlytwitter', linkedin: '', youtube: '', github: '', website: '' },
    })

    expect(result.ok).toBe(true)
    const updateCall = serverCalls.find((c) => c.method === 'update')
    // Only twitter is persisted; the rest are stripped.
    expect(updateCall?.payload).toMatchObject({ social_links: { twitter: '@onlytwitter' } })
    // Defensive: no empty-string fields leak through.
    const serialized = JSON.stringify(updateCall?.payload)
    expect(serialized).not.toContain('linkedin:""')
    expect(serialized).not.toContain('youtube:""')
  })
})

// ===================================================================
// P12.17 — is_public toggle
// ===================================================================

describe('updatePartnerSettingsAction — P12.17 is_public toggle', () => {
  it('accepts is_public=true and writes it to the DB', async () => {
    mockGetServerSupabase.mockResolvedValue(buildSupabaseMock())
    pushResponse({ id: 42, social_links: {}, is_public: false })

    const result = await updatePartnerSettingsAction({ is_public: true })

    expect(result.ok).toBe(true)
    const updateCall = serverCalls.find((c) => c.method === 'update')
    expect(updateCall?.payload).toMatchObject({ is_public: true })
  })

  it('accepts is_public=false and writes it to the DB (toggle off)', async () => {
    mockGetServerSupabase.mockResolvedValue(buildSupabaseMock())
    pushResponse({ id: 42, social_links: {}, is_public: true })

    const result = await updatePartnerSettingsAction({ is_public: false })

    expect(result.ok).toBe(true)
    const updateCall = serverCalls.find((c) => c.method === 'update')
    expect(updateCall?.payload).toMatchObject({ is_public: false })
  })

  it('defaults is_public to false when omitted (opt-out default)', async () => {
    mockGetServerSupabase.mockResolvedValue(buildSupabaseMock())
    pushResponse({ id: 42, social_links: {}, is_public: false })

    // Empty input → all fields at default values; is_public defaults to false.
    const result = await updatePartnerSettingsAction({})

    expect(result.ok).toBe(true)
    const updateCall = serverCalls.find((c) => c.method === 'update')
    expect(updateCall?.payload).toMatchObject({ is_public: false })
  })

  it('rejects non-boolean is_public', async () => {
    mockGetServerSupabase.mockResolvedValue(buildSupabaseMock())
    pushResponse({ id: 42, social_links: {}, is_public: false })

    const result = await updatePartnerSettingsAction({
      is_public: 'yes' as unknown as boolean,
    })

    expect(result.ok).toBe(false)
  })
})

// ===================================================================
// P12.17 — audit-log diff for new fields
// ===================================================================

describe('updatePartnerSettingsAction — P12.17 audit-log diff coverage', () => {
  it('writes an audit row when social_links change', async () => {
    mockGetServerSupabase.mockResolvedValue(buildSupabaseMock())
    pushResponse({
      id: 42,
      bio: null,
      website_url: null,
      tax_country: 'US',
      tax_id: null,
      payout_method: null,
      social_links: {},
      is_public: false,
    })

    await updatePartnerSettingsAction({
      social_links: { twitter: '@new', linkedin: '', youtube: '', github: '', website: '' },
    })

    expect(mockWriteSelfAuditLog).toHaveBeenCalledTimes(1)
    const auditInput = mockWriteSelfAuditLog.mock.calls[0]?.[0]
    expect(auditInput).toMatchObject({
      action: 'settings_self_update',
      targetKind: 'partners',
    })
    const meta = (auditInput as { metadata: { fields_changed: string[]; diff: Record<string, unknown> } }).metadata
    expect(meta.fields_changed).toContain('social_links')
    expect(meta.diff.social_links).toMatchObject({
      before: { value: {} },
      after: { value: { twitter: '@new' } },
    })
  })

  it('writes an audit row when is_public toggles', async () => {
    mockGetServerSupabase.mockResolvedValue(buildSupabaseMock())
    pushResponse({
      id: 42,
      bio: null,
      website_url: null,
      tax_country: 'US',
      tax_id: null,
      payout_method: null,
      social_links: {},
      is_public: false,
    })

    await updatePartnerSettingsAction({ is_public: true })

    expect(mockWriteSelfAuditLog).toHaveBeenCalledTimes(1)
    const auditInput = mockWriteSelfAuditLog.mock.calls[0]?.[0]
    const meta = (auditInput as { metadata: { fields_changed: string[]; diff: Record<string, unknown> } }).metadata
    expect(meta.fields_changed).toContain('is_public')
    expect(meta.diff.is_public).toMatchObject({
      before: { value: false },
      after: { value: true },
    })
  })

  it('does NOT write an audit row when no new fields changed', async () => {
    mockGetServerSupabase.mockResolvedValue(buildSupabaseMock())
    pushResponse({
      id: 42,
      bio: null,
      website_url: null,
      tax_country: 'US',
      tax_id: null,
      payout_method: null,
      social_links: {},
      is_public: false,
    })

    // Empty input → all fields at defaults; diffs are empty (no row).
    await updatePartnerSettingsAction({})

    expect(mockWriteSelfAuditLog).not.toHaveBeenCalled()
  })

  it('NEVER logs the raw PayPal email / tax id in the audit diff', async () => {
    mockGetServerSupabase.mockResolvedValue(buildSupabaseMock())
    pushResponse({
      id: 42,
      bio: null,
      website_url: null,
      tax_country: 'US',
      tax_id: null,
      payout_method: null,
      social_links: {},
      is_public: false,
    })

    const paypalEmail = E('partner', 'example.com')
    await updatePartnerSettingsAction({
      paypal_email: paypalEmail,
      tax_id: '12-3456789',
    })

    expect(mockWriteSelfAuditLog).toHaveBeenCalledTimes(1)
    const auditInput = mockWriteSelfAuditLog.mock.calls[0]?.[0]
    const serialized = JSON.stringify(auditInput)
    // The plaintext PayPal email and tax id must never appear.
    expect(serialized).not.toContain(paypalEmail)
    expect(serialized).not.toContain('12-3456789')
    // The masked forms do appear.
    expect(serialized).toContain('p***@example.com')
    expect(serialized).toMatch(/\*\*\*-\*\*-\d{4}/)
  })
})