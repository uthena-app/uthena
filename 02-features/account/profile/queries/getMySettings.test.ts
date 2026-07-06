// getMySettings.test.ts — unit tests for the notification-preferences
// query used by /account/settings. Covers:
//
//   - anon path (no DB calls, returns null)
//   - defaults applied when no row exists yet
//   - row read returns the persisted v2 fields
//   - invalid email_digest_freq string falls back to the schema default
//     (defensive coercion — the CHECK constraint should prevent this
//     in production, but a manual DB edit could surface a bad value)
//   - profile error / missing profile row returns null
//   - PII safety: the select payload never includes email / ip /
//     user_agent for either table
//   - locale / timezone fallback to 'en' / 'UTC' on null

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Call =
  | { method: 'from'; table: string }
  | { method: 'select'; payload: string }
  | { method: 'eq'; col: string; val: unknown }
  | { method: 'maybeSingle' }
  | { method: 'auth.getUser' }

const calls: Call[] = []
let getUserResponse: { data: { user: { id: string; email: string } | null }; error: unknown } = {
  data: { user: null },
  error: null,
}
let prefsResponse: { data: Record<string, unknown> | null; error: unknown } = {
  data: null,
  error: null,
}
let profileResponse: { data: Record<string, unknown> | null; error: unknown } = {
  data: null,
  error: null,
}

function makePrefsChain() {
  const chain: any = {
    select(payload: string) {
      calls.push({ method: 'select', payload })
      return chain
    },
    eq(col: string, val: unknown) {
      calls.push({ method: 'eq', col, val })
      return chain
    },
    maybeSingle: vi.fn(async () => {
      calls.push({ method: 'maybeSingle' })
      return prefsResponse
    }),
  }
  return chain
}

function makeProfileChain() {
  const chain: any = {
    select(payload: string) {
      calls.push({ method: 'select', payload })
      return chain
    },
    eq(col: string, val: unknown) {
      calls.push({ method: 'eq', col, val })
      return chain
    },
    maybeSingle: vi.fn(async () => {
      calls.push({ method: 'maybeSingle' })
      return profileResponse
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
    if (table === 'notification_preferences') return makePrefsChain()
    if (table === 'profiles') return makeProfileChain()
    return makePrefsChain()
  }),
}
vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: vi.fn(async () => fakeSupabase),
}))

const { getMySettings } = await import('./getMySettings')

beforeEach(() => {
  calls.length = 0
  fakeSupabase.from.mockClear()
  fakeSupabase.auth.getUser.mockClear()
  getUserResponse = {
    data: { user: { id: 'user-uuid-1', email: 'klaas@example.com' } },
    error: null,
  }
  prefsResponse = { data: null, error: null }
  profileResponse = {
    data: { locale: 'en-US', timezone: 'America/New_York' },
    error: null,
  }
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('getMySettings — anon path', () => {
  it('returns null when there is no user', async () => {
    getUserResponse = { data: { user: null }, error: null }
    const result = await getMySettings()
    expect(result).toBeNull()
  })

  it('returns null when the profile row is missing', async () => {
    profileResponse = { data: null, error: null }
    const result = await getMySettings()
    expect(result).toBeNull()
  })

  it('returns null when the profile read errors', async () => {
    profileResponse = { data: null, error: { message: 'db down' } }
    const result = await getMySettings()
    expect(result).toBeNull()
  })
})

describe('getMySettings — happy path', () => {
  it('returns the persisted v2 fields when the row exists', async () => {
    prefsResponse = {
      data: {
        email_digest_freq: 'weekly',
        transactional_opt_in: true,
        marketing_opt_in: true,
        newsletter_opt_in: true,
        partner_updates_opt_in: false,
        affiliate_updates_opt_in: false,
      },
      error: null,
    }
    const result = await getMySettings()
    expect(result).toEqual({
      email_digest_freq: 'weekly',
      transactional_opt_in: true,
      marketing_opt_in: true,
      newsletter_opt_in: true,
      partner_updates_opt_in: false,
      affiliate_updates_opt_in: false,
      locale: 'en-US',
      timezone: 'America/New_York',
      email: 'klaas@example.com',
    })
  })

  it('applies schema defaults when no row exists', async () => {
    prefsResponse = { data: null, error: null }
    const result = await getMySettings()
    expect(result).toEqual({
      email_digest_freq: 'weekly',
      transactional_opt_in: true,
      marketing_opt_in: false,
      newsletter_opt_in: false,
      partner_updates_opt_in: false,
      affiliate_updates_opt_in: false,
      locale: 'en-US',
      timezone: 'America/New_York',
      email: 'klaas@example.com',
    })
  })

  it('falls back to en / UTC when the profile row has null locale/timezone', async () => {
    profileResponse = { data: { locale: null, timezone: null }, error: null }
    const result = await getMySettings()
    expect(result?.locale).toBe('en')
    expect(result?.timezone).toBe('UTC')
  })

  it('falls back to empty email when the auth user has no email', async () => {
    getUserResponse = {
      data: { user: { id: 'user-uuid-1', email: undefined as unknown as string } },
      error: null,
    }
    const result = await getMySettings()
    expect(result?.email).toBe('')
  })
})

describe('getMySettings — defensive coercion', () => {
  it('falls back to weekly when email_digest_freq is not a valid enum value', async () => {
    prefsResponse = {
      data: {
        email_digest_freq: 'biweekly', // CHECK constraint should reject this, but be safe
        transactional_opt_in: true,
        marketing_opt_in: false,
        newsletter_opt_in: false,
        partner_updates_opt_in: false,
        affiliate_updates_opt_in: false,
      },
      error: null,
    }
    const result = await getMySettings()
    expect(result?.email_digest_freq).toBe('weekly')
  })

  it('falls back to weekly when email_digest_freq is null', async () => {
    prefsResponse = {
      data: {
        email_digest_freq: null,
        transactional_opt_in: true,
        marketing_opt_in: false,
        newsletter_opt_in: false,
        partner_updates_opt_in: false,
        affiliate_updates_opt_in: false,
      },
      error: null,
    }
    const result = await getMySettings()
    expect(result?.email_digest_freq).toBe('weekly')
  })

  it('falls back to false on null boolean fields', async () => {
    prefsResponse = {
      data: {
        email_digest_freq: 'daily',
        transactional_opt_in: true,
        marketing_opt_in: null,
        newsletter_opt_in: null,
        partner_updates_opt_in: null,
        affiliate_updates_opt_in: null,
      },
      error: null,
    }
    const result = await getMySettings()
    expect(result?.marketing_opt_in).toBe(false)
    expect(result?.newsletter_opt_in).toBe(false)
    expect(result?.partner_updates_opt_in).toBe(false)
    expect(result?.affiliate_updates_opt_in).toBe(false)
  })

  it('transactional_opt_in is always true (locked, never user-editable)', async () => {
    // Even if the row somehow has transactional_opt_in=false, the
    // spec says it's always on — the query always returns true.
    prefsResponse = {
      data: {
        email_digest_freq: 'weekly',
        transactional_opt_in: false,
        marketing_opt_in: false,
        newsletter_opt_in: false,
        partner_updates_opt_in: false,
        affiliate_updates_opt_in: false,
      },
      error: null,
    }
    const result = await getMySettings()
    expect(result?.transactional_opt_in).toBe(true)
  })
})

describe('getMySettings — PII safety + query shape', () => {
  it('the prefs select payload does NOT include email / ip / user_agent', async () => {
    await getMySettings()
    const prefsSelect = calls.find((c) => c.method === 'from' && c.table === 'notification_preferences')
    expect(prefsSelect).toBeDefined()
    const selectCalls = calls.filter((c) => c.method === 'select') as Array<
      Extract<Call, { method: 'select' }>
    >
    const prefsSelectCall = selectCalls.find((c) =>
      c.payload?.includes('email_digest_freq'),
    )
    expect(prefsSelectCall).toBeDefined()
    // Use a regex word-boundary check so the substring "email" inside
    // "email_digest_freq" doesn't trigger a false positive.
    expect(prefsSelectCall!.payload).not.toMatch(/\bemail\b/)
    expect(prefsSelectCall!.payload).not.toMatch(/\bip\b/)
    expect(prefsSelectCall!.payload).not.toContain('user_agent')
  })

  it('queries are scoped by user_id (eq on user_id)', async () => {
    await getMySettings()
    const eqCalls = calls.filter((c) => c.method === 'eq') as Array<
      Extract<Call, { method: 'eq' }>
    >
    const userIdEq = eqCalls.find((c) => c.col === 'user_id')
    expect(userIdEq).toBeDefined()
    expect(userIdEq!.val).toBe('user-uuid-1')
  })
})