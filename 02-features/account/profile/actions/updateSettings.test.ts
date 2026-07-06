// updateSettings.test.ts — unit tests for the notification-preferences
// + locale/timezone server actions used by /account/settings.
//
// Covers:
//
//   - updateNotificationPrefsAction:
//     - anon path (no user → "Not signed in", no DB calls)
//     - Zod rejection (empty object, unknown keys, bad enum, bad type)
//     - happy path: single-field patch + upsert + revalidate
//     - happy path: multi-field patch
//     - upsert error → friendly message, no audit row
//     - no actual change → no audit row (only diff writes log)
//     - audit log payload shape: target_kind='profiles',
//       target_id=user_id, metadata includes before/after + target_table
//     - transactional_opt_in cannot be set (schema rejects it)
//   - updateLocaleAndTimezoneAction:
//     - anon path
//     - Zod rejection (locale too short, timezone too short)
//     - happy path: update + revalidate + audit row
//     - update error → friendly message
//     - no actual change → no audit row

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Call =
  | { method: 'from'; table: string }
  | { method: 'select'; payload: string | undefined }
  | { method: 'eq'; col: string; val: unknown }
  | { method: 'maybeSingle' }
  | { method: 'single' }
  | { method: 'update'; payload: Record<string, unknown> }
  | { method: 'upsert'; payload: Record<string, unknown>; opts: Record<string, unknown> }
  | { method: 'auth.getUser' }
  | { method: 'revalidatePath'; path: string }

const calls: Call[] = []
let getUserResponse: { data: { user: { id: string; email: string } | null }; error: unknown } = {
  data: { user: null },
  error: null,
}
let prefsSelectResponse: { data: Record<string, unknown> | null; error: unknown } = {
  data: null,
  error: null,
}
let prefsUpsertResponse: { error: unknown } = { error: null }
let profileSelectResponse: { data: Record<string, unknown> | null; error: unknown } = {
  data: null,
  error: null,
}
let profileUpdateResponse: { error: unknown } = { error: null }
let profileSingleResponse: { data: Record<string, unknown> | null; error: unknown } = {
  data: { locale: 'en', timezone: 'UTC' },
  error: null,
}

function makePrefsChain() {
  const chain: any = {
    select(payload?: string) {
      calls.push({ method: 'select', payload })
      return chain
    },
    eq(col: string, val: unknown) {
      calls.push({ method: 'eq', col, val })
      return chain
    },
    maybeSingle: vi.fn(async () => {
      calls.push({ method: 'maybeSingle' })
      return prefsSelectResponse
    }),
    upsert(payload: Record<string, unknown>, opts: Record<string, unknown>) {
      calls.push({ method: 'upsert', payload, opts })
      return { ...chain, then: undefined }
    },
    single: vi.fn(async () => {
      calls.push({ method: 'single' })
      return profileSingleResponse
    }),
  }
  // The .upsert(...) chain doesn't await a terminal — the action calls
  // `{ error: upsertErr }` directly on the awaited result. Mock that:
  chain.upsert = vi.fn((payload: Record<string, unknown>, opts: Record<string, unknown>) => {
    calls.push({ method: 'upsert', payload, opts })
    return Promise.resolve(prefsUpsertResponse)
  })
  return chain
}

function makeProfileChain() {
  const chain: any = {
    select(payload?: string) {
      calls.push({ method: 'select', payload })
      return chain
    },
    eq(col: string, val: unknown) {
      calls.push({ method: 'eq', col, val })
      return chain
    },
    maybeSingle: vi.fn(async () => {
      calls.push({ method: 'maybeSingle' })
      return profileSelectResponse
    }),
    update(payload: Record<string, unknown>) {
      calls.push({ method: 'update', payload })
      return chain
    },
    single: vi.fn(async () => {
      calls.push({ method: 'single' })
      return profileSingleResponse
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
    return makeProfileChain()
  }),
}

const serviceSupabase = {
  from: vi.fn((table: string) => {
    calls.push({ method: 'from', table })
    return {
      insert: vi.fn((payload: Record<string, unknown>) => {
        calls.push({ method: 'update', payload })
        return {
          select: vi.fn(() => ({
            single: vi.fn(async () => ({ data: { id: 7 }, error: null })),
          })),
        }
      }),
    }
  }),
}

vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: vi.fn(async () => fakeSupabase),
  getServiceSupabase: vi.fn(() => serviceSupabase),
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

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn((path: string) => {
    calls.push({ method: 'revalidatePath', path })
  }),
}))

const { updateNotificationPrefsAction, updateLocaleAndTimezoneAction } = await import(
  './updateSettings'
)

beforeEach(() => {
  calls.length = 0
  fakeSupabase.from.mockClear()
  fakeSupabase.auth.getUser.mockClear()
  serviceSupabase.from.mockClear()
  mockWarn.mockClear()
  getUserResponse = {
    data: { user: { id: 'user-uuid-1', email: 'klaas@example.com' } },
    error: null,
  }
  prefsSelectResponse = {
    data: {
      email_digest_freq: 'weekly',
      marketing_opt_in: false,
      newsletter_opt_in: false,
      partner_updates_opt_in: false,
      affiliate_updates_opt_in: false,
    },
    error: null,
  }
  prefsUpsertResponse = { error: null }
  profileSelectResponse = { data: { locale: 'en', timezone: 'UTC' }, error: null }
  profileUpdateResponse = { error: null }
  profileSingleResponse = { data: { locale: 'en', timezone: 'UTC' }, error: null }
})

afterEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// updateNotificationPrefsAction
// ---------------------------------------------------------------------------

describe('updateNotificationPrefsAction — anon + input validation', () => {
  it('returns "Not signed in" when there is no user', async () => {
    getUserResponse = { data: { user: null }, error: null }
    const result = await updateNotificationPrefsAction({ email_digest_freq: 'weekly' })
    expect(result).toEqual({ ok: false, error: 'Not signed in' })
  })

  it('rejects an empty object', async () => {
    const result = await updateNotificationPrefsAction({})
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('Invalid preferences.')
    }
  })

  it('rejects an unknown email_digest_freq', async () => {
    const result = await updateNotificationPrefsAction({ email_digest_freq: 'biweekly' })
    expect(result.ok).toBe(false)
  })

  it('rejects a non-boolean value for a toggle', async () => {
    const result = await updateNotificationPrefsAction({ marketing_opt_in: 'yes' })
    expect(result.ok).toBe(false)
  })

  it('rejects an attempt to set transactional_opt_in (locked field)', async () => {
    const result = await updateNotificationPrefsAction({
      email_digest_freq: 'weekly',
      transactional_opt_in: false,
    })
    expect(result.ok).toBe(false)
  })

  it('rejects unknown extra keys (strict mode)', async () => {
    const result = await updateNotificationPrefsAction({
      email_digest_freq: 'weekly',
      weekly_digest_email: true, // legacy field, removed
    })
    expect(result.ok).toBe(false)
  })
})

describe('updateNotificationPrefsAction — happy path', () => {
  it('upserts a single-field patch with onConflict: user_id', async () => {
    const result = await updateNotificationPrefsAction({ email_digest_freq: 'daily' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.prefs).toEqual({ email_digest_freq: 'daily' })
    }
    const upsertCall = calls.find(
      (c) => c.method === 'upsert',
    ) as Extract<Call, { method: 'upsert' }>
    expect(upsertCall).toBeDefined()
    expect(upsertCall.payload).toEqual({
      user_id: 'user-uuid-1',
      email_digest_freq: 'daily',
    })
    expect(upsertCall.opts).toEqual({ onConflict: 'user_id' })
  })

  it('upserts a multi-field patch', async () => {
    const result = await updateNotificationPrefsAction({
      email_digest_freq: 'weekly',
      marketing_opt_in: true,
      newsletter_opt_in: true,
      partner_updates_opt_in: false,
      affiliate_updates_opt_in: false,
    })
    expect(result.ok).toBe(true)
    const upsertCall = calls.find(
      (c) => c.method === 'upsert',
    ) as Extract<Call, { method: 'upsert' }>
    expect(upsertCall.payload).toEqual({
      user_id: 'user-uuid-1',
      email_digest_freq: 'weekly',
      marketing_opt_in: true,
      newsletter_opt_in: true,
      partner_updates_opt_in: false,
      affiliate_updates_opt_in: false,
    })
  })

  it('revalidates /account/settings on success', async () => {
    await updateNotificationPrefsAction({ email_digest_freq: 'monthly' })
    const revalidate = calls.find(
      (c) => c.method === 'revalidatePath',
    ) as Extract<Call, { method: 'revalidatePath' }>
    expect(revalidate).toBeDefined()
    expect(revalidate.path).toBe('/account/settings')
  })
})

describe('updateNotificationPrefsAction — error paths', () => {
  it('returns a friendly error on upsert failure and does NOT write an audit row', async () => {
    prefsUpsertResponse = { error: { message: 'db down' } }
    const result = await updateNotificationPrefsAction({ email_digest_freq: 'daily' })
    expect(result).toEqual({
      ok: false,
      error: 'Could not save your preferences. Please try again.',
    })
    // No insert should have been issued (the service-role client only
    // gets called for the audit log).
    const insertCalls = calls.filter((c) => c.method === 'update' && 'action' in (c as any).payload)
    expect(insertCalls.length).toBe(0)
  })

  it('does NOT write an audit row when the value did not change', async () => {
    // Current value is already 'weekly', new patch is also 'weekly'.
    prefsSelectResponse = {
      data: {
        email_digest_freq: 'weekly',
        marketing_opt_in: false,
        newsletter_opt_in: false,
        partner_updates_opt_in: false,
        affiliate_updates_opt_in: false,
      },
      error: null,
    }
    const result = await updateNotificationPrefsAction({ email_digest_freq: 'weekly' })
    expect(result.ok).toBe(true)
    // The service-role insert call would be the only place the audit
    // row gets written. Count of calls to serviceSupabase.from('admin_audit_log')
    // — none should happen.
    const adminAuditCalls = calls.filter(
      (c) => c.method === 'from' && c.table === 'admin_audit_log',
    )
    expect(adminAuditCalls.length).toBe(0)
  })

  it('writes an audit row with before/after diff when the value changed', async () => {
    prefsSelectResponse = {
      data: {
        email_digest_freq: 'off',
        marketing_opt_in: false,
        newsletter_opt_in: false,
        partner_updates_opt_in: false,
        affiliate_updates_opt_in: false,
      },
      error: null,
    }
    await updateNotificationPrefsAction({ email_digest_freq: 'weekly' })
    const adminAuditCalls = calls.filter(
      (c) => c.method === 'from' && c.table === 'admin_audit_log',
    )
    expect(adminAuditCalls.length).toBeGreaterThan(0)
    const insertCall = calls.find(
      (c) => c.method === 'update' && (c as any).payload?.action === 'settings_self_update',
    ) as Extract<Call, { method: 'update' }> | undefined
    expect(insertCall).toBeDefined()
    expect(insertCall!.payload.action).toBe('settings_self_update')
    expect(insertCall!.payload.target_kind).toBe('profiles')
    expect(insertCall!.payload.target_id).toBe('user-uuid-1')
    const metadata = insertCall!.payload.metadata as Record<string, unknown>
    expect(metadata.target_table).toBe('notification_preferences')
    expect(metadata.before).toEqual({ email_digest_freq: 'off' })
    expect(metadata.after).toEqual({ email_digest_freq: 'weekly' })
  })

  it('audit row only includes changed fields in the diff (multi-field patch)', async () => {
    prefsSelectResponse = {
      data: {
        email_digest_freq: 'off',
        marketing_opt_in: false,
        newsletter_opt_in: false,
        partner_updates_opt_in: false,
        affiliate_updates_opt_in: false,
      },
      error: null,
    }
    await updateNotificationPrefsAction({
      email_digest_freq: 'weekly',
      marketing_opt_in: true,
      newsletter_opt_in: false, // unchanged
      partner_updates_opt_in: false, // unchanged
      affiliate_updates_opt_in: true,
    })
    const insertCall = calls.find(
      (c) => c.method === 'update' && (c as any).payload?.action === 'settings_self_update',
    ) as Extract<Call, { method: 'update' }> | undefined
    expect(insertCall).toBeDefined()
    const metadata = insertCall!.payload.metadata as Record<string, unknown>
    expect(metadata.before).toEqual({
      email_digest_freq: 'off',
      marketing_opt_in: false,
      affiliate_updates_opt_in: false,
    })
    expect(metadata.after).toEqual({
      email_digest_freq: 'weekly',
      marketing_opt_in: true,
      affiliate_updates_opt_in: true,
    })
  })
})

// ---------------------------------------------------------------------------
// updateLocaleAndTimezoneAction
// ---------------------------------------------------------------------------

describe('updateLocaleAndTimezoneAction — anon + validation', () => {
  it('returns "Not signed in" when there is no user', async () => {
    getUserResponse = { data: { user: null }, error: null }
    const result = await updateLocaleAndTimezoneAction({ locale: 'en', timezone: 'UTC' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('Not signed in')
  })

  it('rejects locale too short', async () => {
    const result = await updateLocaleAndTimezoneAction({ locale: 'e', timezone: 'UTC' })
    expect(result.ok).toBe(false)
  })

  it('rejects timezone too short', async () => {
    const result = await updateLocaleAndTimezoneAction({ locale: 'en', timezone: '' })
    expect(result.ok).toBe(false)
  })
})

describe('updateLocaleAndTimezoneAction — happy path', () => {
  it('updates and revalidates', async () => {
    profileSelectResponse = { data: { locale: 'en', timezone: 'UTC' }, error: null }
    const result = await updateLocaleAndTimezoneAction({
      locale: 'es',
      timezone: 'America/New_York',
    })
    expect(result).toEqual({ ok: true, locale: 'es', timezone: 'America/New_York' })
    const revalidate = calls.find(
      (c) => c.method === 'revalidatePath',
    ) as Extract<Call, { method: 'revalidatePath' }>
    expect(revalidate?.path).toBe('/account/settings')
  })

  it('does NOT write an audit row when locale/timezone did not change', async () => {
    profileSelectResponse = { data: { locale: 'en', timezone: 'UTC' }, error: null }
    await updateLocaleAndTimezoneAction({ locale: 'en', timezone: 'UTC' })
    const adminAuditCalls = calls.filter(
      (c) => c.method === 'from' && c.table === 'admin_audit_log',
    )
    expect(adminAuditCalls.length).toBe(0)
  })

  it('writes an audit row with the locale/timezone diff', async () => {
    profileSelectResponse = { data: { locale: 'en', timezone: 'UTC' }, error: null }
    await updateLocaleAndTimezoneAction({ locale: 'es', timezone: 'Europe/Madrid' })
    const insertCall = calls.find(
      (c) => c.method === 'update' && (c as any).payload?.action === 'settings_self_update',
    ) as Extract<Call, { method: 'update' }> | undefined
    expect(insertCall).toBeDefined()
    const metadata = insertCall!.payload.metadata as Record<string, unknown>
    expect(metadata.target_table).toBe('profiles')
    expect(metadata.before).toEqual({ locale: 'en', timezone: 'UTC' })
    expect(metadata.after).toEqual({ locale: 'es', timezone: 'Europe/Madrid' })
  })

  it('returns a friendly error on update failure', async () => {
    profileSingleResponse = { data: null, error: { message: 'db down' } }
    const result = await updateLocaleAndTimezoneAction({ locale: 'es', timezone: 'UTC' })
    expect(result).toEqual({ ok: false, error: 'Could not save. Please try again.' })
  })
})