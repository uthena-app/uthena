// getMyAffiliateSettings.test.ts — P13.11 settings aggregator tests.
//
// Coverage:
//   - Default-shape return when there's no auth user (anon → safe defaults)
//   - Happy path: full aggregator returns all 3 slices, correctly coerced
//   - Defensive narrowing: bad input on every field falls back to a safe
//     default (never throws)
//   - Fail-soft: each read error is independent — one slice failure
//     doesn't blank the others
//   - PII safety: no raw user_id in any log call (must be FNV-1a hashed)
//   - hasRow flag: distinguishes "row exists with stored value" from
//     "row missing, defaults applied"
//
// All Supabase calls are mocked — pure unit tests, no SQL.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- mock supabase chainable builder ---------------------------------------

function makeChain(initial: { data: unknown; error: unknown } = { data: null, error: null }) {
  const state: { data: unknown; error: unknown } = { ...initial }
  const builder: Record<string, unknown> = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn(() => Promise.resolve({ data: state.data, error: state.error })),
  }
  return { builder, state }
}

// --- mock the supabase + logger modules -----------------------------------

const mockGetServerSupabase = vi.fn()
const mockWarn = vi.fn()

vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: () => mockGetServerSupabase(),
}))

vi.mock('@foundations/log/pino', () => ({
  loggerFor: () => ({ warn: mockWarn }),
}))

/** Build a fake supabase client keyed off per-table `from` handlers. */
function makeFakeSupabase(args: {
  user: { id: string } | null
  fromHandlers: Record<string, () => unknown>
}) {
  return {
    auth: {
      getUser: () =>
        Promise.resolve({
          data: { user: args.user },
          error: null,
        }),
    },
    from: (table: string) => args.fromHandlers[table]!(),
  }
}

beforeEach(() => {
  vi.resetModules()
  mockGetServerSupabase.mockReset()
  mockWarn.mockReset()
})

// Re-import the module under test AFTER resetting mocks so its
// module-scope loggerFor is initialized with the current mock.
async function loadQuery() {
  return await import('./getMyAffiliateSettings')
}

// --- tests ------------------------------------------------------------------

describe('getMyAffiliateSettings — anon caller', () => {
  it('returns the default shape when there is no auth user', async () => {
    mockGetServerSupabase.mockResolvedValue(
      makeFakeSupabase({
        user: null,
        fromHandlers: {},
      }),
    )
    const q = await loadQuery()
    const out = await q.getMyAffiliateSettings()
    expect(out.userId).toBe('')
    expect(out.profile).toEqual({
      displayName: '',
      bio: null,
      locale: 'en-US',
      timezone: 'UTC',
    })
    expect(out.prefs.hasRow).toBe(false)
    expect(out.prefs.affiliateUpdatesOptIn).toBe(false)
    expect(out.prefs.commissionNotificationsOptIn).toBe(true)
    expect(out.prefs.payoutNotificationsOptIn).toBe(true)
    expect(out.prefs.monthlyDigestOptIn).toBe(true)
    expect(out.status.hasRow).toBe(false)
    expect(out.status.status).toBe('pending')
    expect(mockWarn).not.toHaveBeenCalled()
  })
})

describe('getMyAffiliateSettings — happy path', () => {
  it('returns the full aggregator shape on a complete profile + prefs + status row', async () => {
    const profile = makeChain({
      data: {
        display_name: 'Alice',
        bio: 'Loves teaching.',
        locale: 'en-US',
        timezone: 'America/Los_Angeles',
      },
      error: null,
    })
    const prefs = makeChain({
      data: {
        affiliate_updates_opt_in: true,
        commission_notifications_opt_in: false,
        payout_notifications_opt_in: true,
        monthly_digest_opt_in: false,
        email_digest_freq: 'daily',
        marketing_opt_in: true,
        newsletter_opt_in: false,
        transactional_opt_in: true,
      },
      error: null,
    })
    const status = makeChain({
      data: { status: 'approved' },
      error: null,
    })

    mockGetServerSupabase.mockResolvedValue(
      makeFakeSupabase({
        user: { id: 'user-1' },
        fromHandlers: {
          profiles: () => profile.builder,
          notification_preferences: () => prefs.builder,
          affiliates: () => status.builder,
        },
      }),
    )

    const q = await loadQuery()
    const out = await q.getMyAffiliateSettings()
    expect(out.userId).toBe('user-1')
    expect(out.profile).toEqual({
      displayName: 'Alice',
      bio: 'Loves teaching.',
      locale: 'en-US',
      timezone: 'America/Los_Angeles',
    })
    expect(out.prefs.hasRow).toBe(true)
    expect(out.prefs.affiliateUpdatesOptIn).toBe(true)
    expect(out.prefs.commissionNotificationsOptIn).toBe(false)
    expect(out.prefs.payoutNotificationsOptIn).toBe(true)
    expect(out.prefs.monthlyDigestOptIn).toBe(false)
    expect(out.prefs.emailDigestFreq).toBe('daily')
    expect(out.prefs.marketingOptIn).toBe(true)
    expect(out.prefs.newsletterOptIn).toBe(false)
    expect(out.prefs.transactionalOptIn).toBe(true)
    expect(out.status.hasRow).toBe(true)
    expect(out.status.status).toBe('approved')
    expect(mockWarn).not.toHaveBeenCalled()
  })

  it('handles a suspended affiliate + null bio + en-US locale defaults', async () => {
    const profile = makeChain({
      data: { display_name: 'Bob', bio: null, locale: '', timezone: '' },
      error: null,
    })
    const prefs = makeChain({
      data: null,
      error: null,
    })
    const status = makeChain({
      data: { status: 'suspended' },
      error: null,
    })

    mockGetServerSupabase.mockResolvedValue(
      makeFakeSupabase({
        user: { id: 'user-2' },
        fromHandlers: {
          profiles: () => profile.builder,
          notification_preferences: () => prefs.builder,
          affiliates: () => status.builder,
        },
      }),
    )

    const q = await loadQuery()
    const out = await q.getMyAffiliateSettings()
    expect(out.profile).toEqual({
      displayName: 'Bob',
      bio: null,
      locale: 'en-US',
      timezone: 'UTC',
    })
    expect(out.prefs.hasRow).toBe(false)
    expect(out.prefs.affiliateUpdatesOptIn).toBe(false)
    expect(out.prefs.commissionNotificationsOptIn).toBe(true)
    expect(out.status.status).toBe('suspended')
  })

  it('handles an unknown status string by defaulting to pending', async () => {
    const status = makeChain({ data: { status: 'weird-value' }, error: null })
    const profile = makeChain({ data: null, error: null })
    const prefs = makeChain({ data: null, error: null })

    mockGetServerSupabase.mockResolvedValue(
      makeFakeSupabase({
        user: { id: 'user-3' },
        fromHandlers: {
          affiliates: () => status.builder,
          profiles: () => profile.builder,
          notification_preferences: () => prefs.builder,
        },
      }),
    )

    const q = await loadQuery()
    const out = await q.getMyAffiliateSettings()
    expect(out.status.status).toBe('pending')
  })

  it('handles a missing status row by returning hasRow=false + pending', async () => {
    const status = makeChain({ data: null, error: null })
    const profile = makeChain({ data: null, error: null })
    const prefs = makeChain({ data: null, error: null })

    mockGetServerSupabase.mockResolvedValue(
      makeFakeSupabase({
        user: { id: 'user-4' },
        fromHandlers: {
          affiliates: () => status.builder,
          profiles: () => profile.builder,
          notification_preferences: () => prefs.builder,
        },
      }),
    )

    const q = await loadQuery()
    const out = await q.getMyAffiliateSettings()
    expect(out.status).toEqual({ status: 'pending', hasRow: false })
  })
})

describe('getMyAffiliateSettings — defensive narrowing', () => {
  it('coerces boolean-like strings (t/f/true/false) to bool', async () => {
    const profile = makeChain({ data: null, error: null })
    const prefs = makeChain({
      data: {
        affiliate_updates_opt_in: 't',
        commission_notifications_opt_in: 'f',
        payout_notifications_opt_in: 'true',
        monthly_digest_opt_in: 'false',
        email_digest_freq: 'weekly',
        marketing_opt_in: 0, // numeric — coerce to false
        newsletter_opt_in: 1, // numeric — coerce to true
        transactional_opt_in: true,
      },
      error: null,
    })
    const status = makeChain({ data: null, error: null })

    mockGetServerSupabase.mockResolvedValue(
      makeFakeSupabase({
        user: { id: 'user-5' },
        fromHandlers: {
          profiles: () => profile.builder,
          notification_preferences: () => prefs.builder,
          affiliates: () => status.builder,
        },
      }),
    )

    const q = await loadQuery()
    const out = await q.getMyAffiliateSettings()
    expect(out.prefs.affiliateUpdatesOptIn).toBe(true)
    expect(out.prefs.commissionNotificationsOptIn).toBe(false)
    expect(out.prefs.payoutNotificationsOptIn).toBe(true)
    expect(out.prefs.monthlyDigestOptIn).toBe(false)
    expect(out.prefs.marketingOptIn).toBe(false)
    expect(out.prefs.newsletterOptIn).toBe(true)
  })

  it('falls back to weekly for an unrecognized email_digest_freq value', async () => {
    const profile = makeChain({ data: null, error: null })
    const prefs = makeChain({
      data: {
        email_digest_freq: 'biweekly', // not in the enum
        marketing_opt_in: false,
        newsletter_opt_in: false,
        transactional_opt_in: true,
      },
      error: null,
    })
    const status = makeChain({ data: null, error: null })

    mockGetServerSupabase.mockResolvedValue(
      makeFakeSupabase({
        user: { id: 'user-6' },
        fromHandlers: {
          profiles: () => profile.builder,
          notification_preferences: () => prefs.builder,
          affiliates: () => status.builder,
        },
      }),
    )

    const q = await loadQuery()
    const out = await q.getMyAffiliateSettings()
    expect(out.prefs.emailDigestFreq).toBe('weekly')
  })

  it('handles missing display_name gracefully (returns empty string)', async () => {
    const profile = makeChain({
      data: { display_name: null, bio: 'just a bio', locale: 'en-US', timezone: 'UTC' },
      error: null,
    })
    const prefs = makeChain({ data: null, error: null })
    const status = makeChain({ data: null, error: null })

    mockGetServerSupabase.mockResolvedValue(
      makeFakeSupabase({
        user: { id: 'user-7' },
        fromHandlers: {
          profiles: () => profile.builder,
          notification_preferences: () => prefs.builder,
          affiliates: () => status.builder,
        },
      }),
    )

    const q = await loadQuery()
    const out = await q.getMyAffiliateSettings()
    expect(out.profile.displayName).toBe('')
    expect(out.profile.bio).toBe('just a bio')
  })
})

describe('getMyAffiliateSettings — fail-soft per slice', () => {
  it('profile read error does not blank the other slices', async () => {
    const profile = makeChain({
      data: null,
      error: { code: 'PGRST116', message: 'oops' },
    })
    const prefs = makeChain({
      data: {
        affiliate_updates_opt_in: true,
        commission_notifications_opt_in: true,
        payout_notifications_opt_in: true,
        monthly_digest_opt_in: true,
      },
      error: null,
    })
    const status = makeChain({ data: { status: 'approved' }, error: null })

    mockGetServerSupabase.mockResolvedValue(
      makeFakeSupabase({
        user: { id: 'user-8' },
        fromHandlers: {
          profiles: () => profile.builder,
          notification_preferences: () => prefs.builder,
          affiliates: () => status.builder,
        },
      }),
    )

    const q = await loadQuery()
    const out = await q.getMyAffiliateSettings()
    expect(out.profile.displayName).toBe('') // default
    expect(out.prefs.hasRow).toBe(true)
    expect(out.prefs.affiliateUpdatesOptIn).toBe(true)
    expect(out.status.status).toBe('approved')
    expect(mockWarn).toHaveBeenCalledTimes(1)
    expect(mockWarn.mock.calls[0]?.[0]).toEqual({
      user_id_hash: expect.stringMatching(/^[0-9a-f]{8}$/),
      code: 'PGRST116',
    })
  })

  it('prefs read error does not blank the profile or status', async () => {
    const profile = makeChain({
      data: { display_name: 'Carol', bio: null, locale: 'en-US', timezone: 'UTC' },
      error: null,
    })
    const prefs = makeChain({
      data: null,
      error: { code: 'PGRST301', message: 'prefs down' },
    })
    const status = makeChain({ data: { status: 'pending' }, error: null })

    mockGetServerSupabase.mockResolvedValue(
      makeFakeSupabase({
        user: { id: 'user-9' },
        fromHandlers: {
          profiles: () => profile.builder,
          notification_preferences: () => prefs.builder,
          affiliates: () => status.builder,
        },
      }),
    )

    const q = await loadQuery()
    const out = await q.getMyAffiliateSettings()
    expect(out.profile.displayName).toBe('Carol')
    expect(out.prefs.hasRow).toBe(false) // defaults
    expect(out.prefs.commissionNotificationsOptIn).toBe(true) // default
    expect(out.status.status).toBe('pending')
    expect(mockWarn).toHaveBeenCalledTimes(1)
  })

  it('status read error does not blank the profile or prefs', async () => {
    const profile = makeChain({
      data: { display_name: 'Dave', bio: null, locale: 'en-US', timezone: 'UTC' },
      error: null,
    })
    const prefs = makeChain({ data: null, error: null })
    const status = makeChain({
      data: null,
      error: { code: 'PGRST500', message: 'status down' },
    })

    mockGetServerSupabase.mockResolvedValue(
      makeFakeSupabase({
        user: { id: 'user-10' },
        fromHandlers: {
          profiles: () => profile.builder,
          notification_preferences: () => prefs.builder,
          affiliates: () => status.builder,
        },
      }),
    )

    const q = await loadQuery()
    const out = await q.getMyAffiliateSettings()
    expect(out.profile.displayName).toBe('Dave')
    expect(out.status.status).toBe('pending')
    expect(mockWarn).toHaveBeenCalledTimes(1)
  })

  it('all three slices failing produces 3 warn calls + safe defaults for each', async () => {
    const profile = makeChain({ data: null, error: { code: 'A', message: 'a' } })
    const prefs = makeChain({ data: null, error: { code: 'B', message: 'b' } })
    const status = makeChain({ data: null, error: { code: 'C', message: 'c' } })

    mockGetServerSupabase.mockResolvedValue(
      makeFakeSupabase({
        user: { id: 'user-11' },
        fromHandlers: {
          profiles: () => profile.builder,
          notification_preferences: () => prefs.builder,
          affiliates: () => status.builder,
        },
      }),
    )

    const q = await loadQuery()
    const out = await q.getMyAffiliateSettings()
    expect(out.profile.displayName).toBe('')
    expect(out.prefs.hasRow).toBe(false)
    expect(out.status.hasRow).toBe(false)
    expect(mockWarn).toHaveBeenCalledTimes(3)
  })
})

describe('getMyAffiliateSettings — PII safety', () => {
  it('never logs the raw user_id in warn payloads', async () => {
    const profile = makeChain({ data: null, error: { code: 'X', message: 'x' } })
    const prefs = makeChain({ data: null, error: null })
    const status = makeChain({ data: null, error: null })

    mockGetServerSupabase.mockResolvedValue(
      makeFakeSupabase({
        user: { id: 'super-secret-uuid-that-must-never-be-logged' },
        fromHandlers: {
          profiles: () => profile.builder,
          notification_preferences: () => prefs.builder,
          affiliates: () => status.builder,
        },
      }),
    )

    const q = await loadQuery()
    await q.getMyAffiliateSettings()

    // Every warn call must have hashed the user_id (8-char hex) and
    // never included the raw user_id.
    expect(mockWarn).toHaveBeenCalledTimes(1)
    const warnPayload = mockWarn.mock.calls[0]?.[0] as Record<string, unknown>
    expect(warnPayload?.user_id_hash).toMatch(/^[0-9a-f]{8}$/)
    const payloadStr = JSON.stringify(warnPayload)
    expect(payloadStr).not.toContain('super-secret-uuid')
  })
})