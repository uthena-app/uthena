// getCurrentConsent.test.ts — unit tests for the server query that
// backs the /cookie-preferences page.
//
// Covers:
//   - Anon caller → DEFAULT_CONSENT + hasRecord:false, no DB call.
//   - Signed-in happy path → returns the latest row's booleans +
//     hasRecord:true. Asserts the query shape (RLS-friendly
//     `.eq('user_id', user.id)`, `order('created_at', { ascending: false })`,
//     `limit(1)`, `maybeSingle()`, the minimal PII-safe select payload).
//   - Empty result → DEFAULT_CONSENT + hasRecord:false.
//   - DB error → DEFAULT_CONSENT + hasRecord:false (fail-soft).
//   - Defensive coercion: non-boolean column values fall back to
//     DEFAULT_CONSENT for that field.
//   - essential is always true in the returned shape (the schema
//     locks it; the query reflects that contract).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Call =
  | { method: 'auth.getUser' }
  | { method: 'from'; table: string }
  | { method: 'select'; payload: string }
  | { method: 'eq'; col: string; val: unknown }
  | { method: 'order'; col: string; ascending: boolean }
  | { method: 'limit'; n: number }
  | { method: 'maybeSingle' }

const calls: Call[] = []
let getUserResponse: { data: { user: { id: string; email: string } | null }; error: unknown } = {
  data: { user: null },
  error: null,
}
let consentResponse: {
  data: { analytics: unknown; marketing: unknown; created_at?: string } | null
  error: unknown
} = { data: null, error: null }

function makeConsentChain() {
  const chain: any = {
    select(payload: string) {
      calls.push({ method: 'select', payload })
      return chain
    },
    eq(col: string, val: unknown) {
      calls.push({ method: 'eq', col, val })
      return chain
    },
    order(col: string, opts: { ascending?: boolean } = {}) {
      calls.push({ method: 'order', col, ascending: opts.ascending ?? true })
      return chain
    },
    limit(n: number) {
      calls.push({ method: 'limit', n })
      return chain
    },
    maybeSingle: vi.fn(async () => {
      calls.push({ method: 'maybeSingle' })
      return consentResponse
    }),
  }
  return chain
}

const fakeSupabase = {
  auth: {
    getUser: vi.fn(async () => {
      calls.push({ method: 'auth.getUser' })
      return getUserResponse
    }),
  },
  from: vi.fn((table: string) => {
    calls.push({ method: 'from', table })
    if (table === 'consent_log') return makeConsentChain()
    return makeConsentChain()
  }),
}

vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: vi.fn(async () => fakeSupabase),
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

const { getCurrentConsent } = await import('./getCurrentConsent')

beforeEach(() => {
  calls.length = 0
  getUserResponse = { data: { user: null }, error: null }
  consentResponse = { data: null, error: null }
  mockWarn.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('getCurrentConsent — anon path', () => {
  it('returns DEFAULT_CONSENT + hasRecord:false with no DB read', async () => {
    const result = await getCurrentConsent()
    expect(result).toEqual({
      ok: true,
      consent: { essential: true, analytics: false, marketing: false },
      hasRecord: false,
    })
    expect(calls).toEqual([{ method: 'auth.getUser' }])
  })
})

describe('getCurrentConsent — signed-in happy path', () => {
  beforeEach(() => {
    getUserResponse = { data: { user: { id: 'user-123', email: 'k@k.com' } }, error: null }
    consentResponse = {
      data: { analytics: true, marketing: false, created_at: '2026-06-29T12:00:00Z' },
      error: null,
    }
  })

  it('returns the latest row booleans + hasRecord:true', async () => {
    const result = await getCurrentConsent()
    expect(result).toEqual({
      ok: true,
      consent: { essential: true, analytics: true, marketing: false },
      hasRecord: true,
    })
  })

  it('queries consent_log with RLS-friendly eq + order + limit', async () => {
    await getCurrentConsent()
    expect(calls).toEqual([
      { method: 'auth.getUser' },
      { method: 'from', table: 'consent_log' },
      // The select payload must NOT include ip_hash / user_agent / id
      // (PII safety) — assert the exact payload.
      { method: 'select', payload: 'analytics, marketing, created_at' },
      { method: 'eq', col: 'user_id', val: 'user-123' },
      { method: 'order', col: 'created_at', ascending: false },
      { method: 'limit', n: 1 },
      { method: 'maybeSingle' },
    ])
  })

  it('essential is always true in the returned shape (the schema locks it)', async () => {
    const result = await getCurrentConsent()
    if (!result.ok) throw new Error('expected ok')
    expect(result.consent.essential).toBe(true)
  })
})

describe('getCurrentConsent — empty / error / defensive paths', () => {
  beforeEach(() => {
    getUserResponse = { data: { user: { id: 'user-123', email: 'k@k.com' } }, error: null }
  })

  it('empty result (no prior consent row) → DEFAULT + hasRecord:false', async () => {
    consentResponse = { data: null, error: null }
    const result = await getCurrentConsent()
    expect(result).toEqual({
      ok: true,
      consent: { essential: true, analytics: false, marketing: false },
      hasRecord: false,
    })
  })

  it('DB error → DEFAULT + hasRecord:false, warn logged', async () => {
    consentResponse = { data: null, error: { message: 'connection refused' } }
    const result = await getCurrentConsent()
    expect(result).toEqual({
      ok: true,
      consent: { essential: true, analytics: false, marketing: false },
      hasRecord: false,
    })
    expect(mockWarn).toHaveBeenCalled()
    const [, message] = mockWarn.mock.calls[0] as [unknown, string]
    expect(message).toBe('consent read failed')
  })

  it('defensive coercion: non-boolean analytics → DEFAULT.analytics', async () => {
    consentResponse = { data: { analytics: 'true' as unknown, marketing: true, created_at: '' }, error: null }
    const result = await getCurrentConsent()
    if (!result.ok) throw new Error('expected ok')
    expect(result.consent.analytics).toBe(false) // fallback to default
    expect(result.consent.marketing).toBe(true) // passed through
  })

  it('defensive coercion: null marketing → DEFAULT.marketing', async () => {
    consentResponse = { data: { analytics: true, marketing: null as unknown, created_at: '' }, error: null }
    const result = await getCurrentConsent()
    if (!result.ok) throw new Error('expected ok')
    expect(result.consent.analytics).toBe(true)
    expect(result.consent.marketing).toBe(false)
  })
})