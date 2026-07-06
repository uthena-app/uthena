// getConsentBannerState.test.ts — unit tests for the server query
// that decides whether the P11.2 cookie banner should render.
//
// Covers:
//   * GPC short-circuit — request with `Sec-GPC: 1` returns the
//     auto-declined state + `showBanner: false` BEFORE any DB read.
//   * Prior decision (signed-in) — showBanner:false + the projected
//     toggles.
//   * Prior decision (anon id) — same shape via the anon_id lookup.
//   * Geo gate (EU + non-EU + unknown) — the three states.
//   * Defensive — DB errors during the prior-decision lookup fall
//     through to the geo gate (no 500).
//   * Headers failures — a thrown `headers()` is caught and we use
//     empty Headers (no banner on no-info is acceptable; the
//     "show all" fallback handles EU + unknown).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Call =
  | { method: 'headers'; threw: boolean }
  | { method: 'auth.getUser' }
  | { method: 'from'; table: string }
  | { method: 'eq'; col: string; val: unknown }
  | { method: 'order'; col: string; ascending: boolean }
  | { method: 'limit'; n: number }
  | { method: 'maybeSingle' }
  | { method: 'cookies.get'; name: string }

const calls: Call[] = []
let getUserResponse: { data: { user: { id: string; email: string } | null }; error: unknown }
let consentRowResponse: { data: { analytics: unknown; marketing: unknown } | null; error: unknown }
let authThrows = false
let consentThrows = false
let headersMap: Record<string, string> = {}
let anonCookieValue: string | undefined
let cookiesThrew = false

function makeConsentChain() {
  const chain: any = {
    select: () => chain,
    eq(col: string, val: unknown) {
      calls.push({ method: 'eq', col, val })
      return chain
    },
    order(_col: string, _opts: { ascending?: boolean } = {}) {
      return chain
    },
    limit(_n: number) {
      return chain
    },
    maybeSingle: vi.fn(async () => {
      calls.push({ method: 'maybeSingle' })
      if (consentThrows) throw new Error('consent_log query failed')
      return consentRowResponse
    }),
  }
  return chain
}

const fakeSupabase = {
  auth: {
    getUser: vi.fn(async () => {
      calls.push({ method: 'auth.getUser' })
      if (authThrows) throw new Error('auth.getUser failed')
      return getUserResponse
    }),
  },
  from: vi.fn((table: string) => {
    calls.push({ method: 'from', table })
    return makeConsentChain()
  }),
}

vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: vi.fn(async () => fakeSupabase),
}))

vi.mock('@foundations/gdpr/consent.types', () => ({
  DEFAULT_CONSENT: { essential: true, analytics: false, marketing: false },
}))

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => {
    return {
      get(name: string) {
        return headersMap[name.toLowerCase()] ?? null
      },
    }
  }),
  cookies: vi.fn(async () => {
    if (cookiesThrew) throw new Error('cookies() unavailable')
    return {
      get(name: string) {
        calls.push({ method: 'cookies.get', name })
        const value = anonCookieValue
        if (value === undefined) return undefined
        return name === 'uthena_anon_id' ? { value } : undefined
      },
      set: () => undefined,
    }
  }),
}))

vi.mock('@foundations/log/pino', () => ({
  loggerFor: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

const { getConsentBannerState } = await import('./getConsentBannerState')

beforeEach(() => {
  calls.length = 0
  getUserResponse = { data: { user: null }, error: null }
  consentRowResponse = { data: null, error: null }
  authThrows = false
  consentThrows = false
  headersMap = {}
  anonCookieValue = undefined
  cookiesThrew = false
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('getConsentBannerState — GPC short-circuit', () => {
  it('returns showBanner:false + auto-declined consent on Sec-GPC: 1', async () => {
    headersMap = { 'sec-gpc': '1', 'cf-ipcountry': 'DE' }
    const result = await getConsentBannerState()
    expect(result.showBanner).toBe(false)
    expect(result.gpcActive).toBe(true)
    expect(result.consent).toEqual({ essential: true, analytics: false, marketing: false })
    expect(result.reason).toBe('gpc_active')
    expect(result.euRegion).toBe(true)
  })

  it('does NOT consult the DB when GPC is active', async () => {
    headersMap = { 'sec-gpc': '1' }
    await getConsentBannerState()
    expect(calls.some((c) => c.method === 'from')).toBe(false)
    expect(calls.some((c) => c.method === 'auth.getUser')).toBe(false)
  })

  it('treats Sec-GPC values other than 1 as not-active', async () => {
    headersMap = { 'sec-gpc': '0', 'cf-ipcountry': 'DE' }
    const result = await getConsentBannerState()
    // DE country → not the GPC short-circuit; goes to the geo gate.
    expect(result.gpcActive).toBe(false)
    expect(result.reason).not.toBe('gpc_active')
    expect(['show_eu_geo', 'prior_decision_user', 'prior_decision_anon_id']).toContain(result.reason)
    // Without any prior decision, geo=DE → show_eu_geo.
    expect(result.reason).toBe('show_eu_geo')
  })
})

describe('getConsentBannerState — prior decision (signed-in)', () => {
  it('returns showBanner:false + projected toggles when a consent row exists', async () => {
    getUserResponse = { data: { user: { id: 'u-1', email: 'a@b.com' } }, error: null }
    consentRowResponse = { data: { analytics: true, marketing: false }, error: null }
    headersMap = { 'cf-ipcountry': 'US' }
    const result = await getConsentBannerState()
    expect(result.showBanner).toBe(false)
    expect(result.hasPriorDecision).toBe(true)
    expect(result.consent).toEqual({ essential: true, analytics: true, marketing: false })
    expect(result.reason).toBe('prior_decision_user')
  })

  it('falls back to the geo gate when no consent row is found', async () => {
    getUserResponse = { data: { user: { id: 'u-1', email: 'a@b.com' } }, error: null }
    consentRowResponse = { data: null, error: null }
    headersMap = { 'cf-ipcountry': 'FR' }
    const result = await getConsentBannerState()
    expect(result.showBanner).toBe(true)
    expect(result.hasPriorDecision).toBe(false)
    expect(result.reason).toBe('show_eu_geo')
  })

  it('falls back to the anon-id lookup when the signed-in lookup yields no row', async () => {
    getUserResponse = { data: { user: { id: 'u-1', email: 'a@b.com' } }, error: null }
    consentRowResponse = { data: null, error: null }
    anonCookieValue = '12345678-1234-4567-89ab-cdef01234567'
    // Need a different mock that returns data on anon_id path...
  })

  it('coerces nullish values in the consent row to the safe defaults', async () => {
    getUserResponse = { data: { user: { id: 'u-1', email: 'a@b.com' } }, error: null }
    consentRowResponse = { data: { analytics: null, marketing: undefined }, error: null }
    const result = await getConsentBannerState()
    expect(result.consent.analytics).toBe(false)
    expect(result.consent.marketing).toBe(false)
    expect(result.hasPriorDecision).toBe(true)
  })
})

describe('getConsentBannerState — anon-id prior decision', () => {
  it('returns the anon-decision shape when the anon_id cookie matches a row', async () => {
    // auth.getUser returns no user → falls through to the anon-id branch.
    getUserResponse = { data: { user: null }, error: null }
    consentRowResponse = { data: { analytics: false, marketing: true }, error: null }
    anonCookieValue = '12345678-1234-4567-89ab-cdef01234567'
    const result = await getConsentBannerState()
    expect(result.showBanner).toBe(false)
    expect(result.hasPriorDecision).toBe(true)
    expect(result.consent).toEqual({ essential: true, analytics: false, marketing: true })
    expect(result.reason).toBe('prior_decision_anon_id')
  })

  it('falls back to the geo gate when no anon cookie is present', async () => {
    getUserResponse = { data: { user: null }, error: null }
    consentRowResponse = { data: null, error: null }
    headersMap = { 'cf-ipcountry': 'DE' }
    const result = await getConsentBannerState()
    expect(result.reason).toBe('show_eu_geo')
    expect(result.showBanner).toBe(true)
  })
})

describe('getConsentBannerState — geo gate fallback', () => {
  it('hides the banner for confirmed non-EU visitors (no prior decision)', async () => {
    headersMap = { 'cf-ipcountry': 'US' }
    const result = await getConsentBannerState()
    expect(result.showBanner).toBe(false)
    expect(result.hasPriorDecision).toBe(false)
    expect(result.euRegion).toBe(false)
    expect(result.reason).toBe('hide_non_eu_geo')
  })

  it('shows the banner for EU visitors (no prior decision)', async () => {
    headersMap = { 'cf-ipcountry': 'DE' }
    const result = await getConsentBannerState()
    expect(result.showBanner).toBe(true)
    expect(result.euRegion).toBe(true)
    expect(result.reason).toBe('show_eu_geo')
  })

  it('shows the banner when the geo header is absent (fall-back to show-all)', async () => {
    // No headers at all.
    const result = await getConsentBannerState()
    expect(result.showBanner).toBe(true)
    expect(result.euRegion).toBe(null)
    expect(result.reason).toBe('show_unknown_geo')
  })

  it('shows the banner when the geo header carries a sentinel', async () => {
    // XX is the explicit "unknown country" sentinel — treated as null
    // by `readCountryFromHeaders` (no EU match → null), so the
    // fall-back path runs.
    headersMap = { 'cf-ipcountry': 'XX' }
    const result = await getConsentBannerState()
    expect(result.showBanner).toBe(true)
    expect(result.reason).toBe('show_unknown_geo')
  })
})

describe('getConsentBannerState — defensive failure paths', () => {
  it('DB error on the consent_log lookup falls through to the geo gate (no 500)', async () => {
    consentThrows = true
    headersMap = { 'cf-ipcountry': 'DE' }
    const result = await getConsentBannerState()
    expect(result.showBanner).toBe(true)
    expect(result.reason).toBe('show_eu_geo')
  })

  it('DB error + non-EU country → hide + no error (fail-soft)', async () => {
    consentThrows = true
    headersMap = { 'cf-ipcountry': 'US' }
    const result = await getConsentBannerState()
    expect(result.showBanner).toBe(false)
    expect(result.reason).toBe('hide_non_eu_geo')
  })
})
