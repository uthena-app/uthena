// recordBannerDecision.test.ts — unit tests for the P11.2 server
// action that records a cookie-banner consent decision.
//
// Covers:
//   * Input validation: missing/wrong-typed toggles, missing source,
//     invalid source (not in the enum).
//   * Happy path: anon + signed-in → consent_log row written via the
//     `recordConsent` helper with the new metadata fields (country,
//     gpc, source, anonId) captured from the request context.
//   * Geo/GPC plumbing: country + GPC flag persist to the metadata.
//   * Anon-id: ensures the cookie is set when present; doesn't poison
//     a previous value.
//   * Defensive: empty anon-id (test mode), IP-extraction, the action
//     returns { ok: false } when `recordConsent` reports failure.
//   * Revalidate: `revalidatePath('/', 'layout')` runs on success.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Call =
  | { method: 'headers.get'; name: string }
  | { method: 'cookies.get'; name: string }
  | { method: 'cookies.set'; name: string; value: string }
  | { method: 'auth.getUser' }
  | { method: 'recordConsent'; payload: unknown }
  | { method: 'revalidatePath'; path: string; kind: string }

const calls: Call[] = []
let getUserResponse: { data: { user: { id: string; email: string } | null }; error: unknown }
let headerMap: Record<string, string> = {}
let anonCookieValue: string | undefined
let recordConsentReturn: { ok: boolean } = { ok: true }
let cookiesThrewOnSet = false

const fakeSupabase = {
  auth: {
    getUser: vi.fn(async () => {
      calls.push({ method: 'auth.getUser' })
      return getUserResponse
    }),
  },
}

vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: vi.fn(async () => fakeSupabase),
}))

vi.mock('@foundations/gdpr/consent', () => ({
  recordConsent: vi.fn(
    async (
      userId: string | null,
      state: unknown,
      ip: string,
      ua: string,
      metadata: unknown,
    ) => {
      calls.push({ method: 'recordConsent', payload: { userId, state, ip, ua, metadata } })
      return recordConsentReturn
    },
  ),
}))

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => ({
    get(name: string) {
      calls.push({ method: 'headers.get', name })
      return headerMap[name.toLowerCase()] ?? null
    },
  })),
  cookies: vi.fn(async () => {
    return {
      get: (name: string) => {
        calls.push({ method: 'cookies.get', name })
        if (name !== 'uthena_anon_id') return undefined
        return anonCookieValue === undefined ? undefined : { value: anonCookieValue }
      },
      set: (input: { name: string; value: string }) => {
        if (cookiesThrewOnSet) throw new Error('cookies() set threw')
        calls.push({ method: 'cookies.set', name: input.name, value: input.value })
        anonCookieValue = input.value
      },
    }
  }),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn((path: string, kind: string) => {
    calls.push({ method: 'revalidatePath', path, kind })
  }),
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

const { recordBannerDecisionAction } = await import('./recordBannerDecision')

beforeEach(() => {
  calls.length = 0
  getUserResponse = { data: { user: null }, error: null }
  headerMap = {}
  anonCookieValue = undefined
  recordConsentReturn = { ok: true }
  cookiesThrewOnSet = false
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('recordBannerDecisionAction — input validation', () => {
  it('rejects non-object input', async () => {
    const r = await recordBannerDecisionAction('not-an-object')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_input')
  })

  it('rejects missing analytics', async () => {
    const r = await recordBannerDecisionAction({ marketing: true, source: 'banner_accept_all' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_input')
  })

  it('rejects missing marketing', async () => {
    const r = await recordBannerDecisionAction({ analytics: false, source: 'banner_decline_non_essential' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_input')
  })

  it('rejects a non-enum source', async () => {
    const r = await recordBannerDecisionAction({
      analytics: false,
      marketing: false,
      source: 'totally-not-a-source',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_input')
  })

  it('rejects missing source', async () => {
    const r = await recordBannerDecisionAction({ analytics: false, marketing: false })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_input')
  })

  it('rejects a non-boolean toggle', async () => {
    const r = await recordBannerDecisionAction({
      analytics: 'yes',
      marketing: false,
      source: 'banner_accept_all',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_input')
  })

  it('accepts every legal `source` value', async () => {
    for (const source of [
      'banner_accept_all',
      'banner_decline_non_essential',
      'banner_save_preferences',
    ] as const) {
      const r = await recordBannerDecisionAction({
        analytics: false,
        marketing: false,
        source,
      })
      expect(r.ok).toBe(true)
    }
  })
})

describe('recordBannerDecisionAction — happy path', () => {
  it('writes the consent_log row with the new metadata (signed-in, EU, no GPC)', async () => {
    getUserResponse = { data: { user: { id: 'u-1', email: 'a@b.com' } }, error: null }
    headerMap = {
      'cf-ipcountry': 'DE',
      'sec-gpc': '',
      'x-forwarded-for': '203.0.113.7, 10.0.0.1',
      'user-agent': 'Mozilla/5.0 ...',
    }
    anonCookieValue = '12345678-1234-4567-89ab-cdef01234567'

    const r = await recordBannerDecisionAction({
      analytics: true,
      marketing: true,
      source: 'banner_accept_all',
    })

    expect(r.ok).toBe(true)
    expect(recordConsentCall()).toMatchObject({
      userId: 'u-1',
      state: { essential: true, analytics: true, marketing: true },
      ip: '203.0.113.7',
      metadata: {
        country: 'DE',
        gpc: false,
        source: 'banner_accept_all',
        anonId: '12345678-1234-4567-89ab-cdef01234567',
      },
    })
  })

  it('writes the consent_log row for an anon visitor with no user_id', async () => {
    headerMap = {
      'cf-ipcountry': 'FR',
      'x-real-ip': '198.51.100.42',
      'user-agent': 'Mozilla/5.0 ...',
    }
    getUserResponse = { data: { user: null }, error: null }
    anonCookieValue = undefined // forces anon-id to mint a new one

    const r = await recordBannerDecisionAction({
      analytics: false,
      marketing: false,
      source: 'banner_decline_non_essential',
    })

    expect(r.ok).toBe(true)
    const call = recordConsentCall() as {
      userId: unknown
      state: unknown
      metadata: { country: string; source: string; anonId: string }
    }
    expect(call.userId).toBe(null)
    expect(call.metadata.country).toBe('FR')
    expect(call.metadata.source).toBe('banner_decline_non_essential')
    expect(call.metadata.anonId).toMatch(/^[0-9a-f-]{36}$/)
    // The cookie should have been set to the new anon id.
    expect(calls.some((c) => c.method === 'cookies.set' && c.name === 'uthena_anon_id')).toBe(true)
  })

  it('captures Sec-GPC=1 as gpc=true in the metadata', async () => {
    headerMap = { 'sec-gpc': '1', 'cf-ipcountry': 'DE' }
    getUserResponse = { data: { user: null }, error: null }
    const r = await recordBannerDecisionAction({
      analytics: false,
      marketing: false,
      source: 'banner_decline_non_essential',
    })
    expect(r.ok).toBe(true)
    expect(recordConsentCall()).toMatchObject({
      metadata: { gpc: true, country: 'DE', source: 'banner_decline_non_essential' },
    })
  })

  it('omits the country when no geo header is present (preserves null)', async () => {
    getUserResponse = { data: { user: null }, error: null }
    const r = await recordBannerDecisionAction({
      analytics: true,
      marketing: true,
      source: 'banner_accept_all',
    })
    expect(r.ok).toBe(true)
    expect(recordConsentCall()).toMatchObject({
      metadata: { country: null, gpc: false, source: 'banner_accept_all' },
    })
  })

  it('uses x-real-ip when no x-forwarded-for is present', async () => {
    headerMap = { 'x-real-ip': '198.51.100.42' }
    getUserResponse = { data: { user: null }, error: null }
    await recordBannerDecisionAction({
      analytics: false,
      marketing: false,
      source: 'banner_decline_non_essential',
    })
    expect(recordConsentCall()).toMatchObject({ ip: '198.51.100.42' })
  })

  it('falls back to 0.0.0.0 when no IP header is present', async () => {
    getUserResponse = { data: { user: null }, error: null }
    await recordBannerDecisionAction({
      analytics: false,
      marketing: false,
      source: 'banner_decline_non_essential',
    })
    expect(recordConsentCall()).toMatchObject({ ip: '0.0.0.0' })
  })
})

describe('recordBannerDecisionAction — failure paths', () => {
  it('returns ok:false when recordConsent reports failure', async () => {
    recordConsentReturn = { ok: false }
    headerMap = {}
    const r = await recordBannerDecisionAction({
      analytics: false,
      marketing: false,
      source: 'banner_decline_non_essential',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('unknown')
  })

  it('does not revalidate when the write fails', async () => {
    recordConsentReturn = { ok: false }
    headerMap = {}
    await recordBannerDecisionAction({
      analytics: false,
      marketing: false,
      source: 'banner_decline_non_essential',
    })
    expect(calls.some((c) => c.method === 'revalidatePath')).toBe(false)
  })

  it('calls revalidatePath("/", "layout") on success', async () => {
    headerMap = {}
    getUserResponse = { data: { user: null }, error: null }
    await recordBannerDecisionAction({
      analytics: true,
      marketing: true,
      source: 'banner_accept_all',
    })
    expect(
      calls.some((c) => c.method === 'revalidatePath' && c.path === '/' && c.kind === 'layout'),
    ).toBe(true)
  })

  it('survives when cookies() throws (no crash, still writes the row)', async () => {
    cookiesThrewOnSet = true
    headerMap = {}
    const r = await recordBannerDecisionAction({
      analytics: true,
      marketing: true,
      source: 'banner_accept_all',
    })
    expect(r.ok).toBe(true)
    // Still recorded — the cookie-set failure is best-effort.
    expect(calls.some((c) => c.method === 'recordConsent')).toBe(true)
  })
})

function recordConsentCall(): unknown {
  const c = calls.find((x) => x.method === 'recordConsent')
  if (!c || c.method !== 'recordConsent') {
    throw new Error('recordConsent was not called')
  }
  return c.payload
}
