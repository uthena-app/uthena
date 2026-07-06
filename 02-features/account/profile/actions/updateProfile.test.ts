// updateProfile.test.ts — unit tests for the updateProfileAction
// server action. Covers:
//
//   - Anon caller → "Not signed in" (no DB write).
//   - Zod input validation: every field's rejection path runs BEFORE
//     any DB call (defense in depth — the form validates too, but
//     the server must hold the contract for any direct caller).
//   - Happy path: row is updated with normalized values (empty bio
//     → null, missing avatar_url → null), revalidatePath fires,
//     `ok: true` returned with the normalized profile.
//   - Diffing: when nothing changed, the audit log is NOT written.
//   - Diffing: when only some fields changed, the audit metadata
//     contains ONLY the changed keys (before + after) and never
//     leaks the email or other PII.
//   - DB error: returns "Could not save" generic message; no PII
//     in the warn log payload (defensive against check:pii).
//   - Headers: the action forwards x-forwarded-for (first hop) and
//     user-agent to the audit log row.
//
// Strategy: same mocks as cart actions (see updateLicense.test.ts).
// The two Supabase calls (read before + update) are recorded as a
// `Call[]` array, then asserted in test bodies. `writeSelfAuditLog`
// is mocked at module boundary so we can capture its call args
// without testing the audit log writer here (writeSelfAuditLog.test.ts
// owns that surface).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const revalidateCalls: string[] = []
vi.mock('next/cache', () => ({
  revalidatePath: (path: string) => {
    revalidateCalls.push(path)
  },
}))

const headerStore = new Map<string, string>()
vi.mock('next/headers', () => ({
  headers: vi.fn(async () => ({
    get: (name: string) => headerStore.get(name.toLowerCase()) ?? null,
  })),
}))

type Call =
  | { method: 'select'; payload: string }
  | { method: 'eq'; col: string; val: unknown }
  | { method: 'maybeSingle' }
  | { method: 'update'; payload: unknown }
  | { method: 'insert'; payload: unknown }
  | { method: 'single' }

const calls: Call[] = []
let mockUser: { id: string; email: string | null } | null = null
let beforeQueue: Array<{ data: unknown; error: unknown }> = []
let updateQueue: Array<{ data: unknown; error: unknown }> = []

function makeChain() {
  // The chain is also thenable — `await supabase.from(...).update(...).eq(...)`
  // resolves to the queued update response. This mirrors the Supabase
  // JS client where every chained method returns a builder that is also
  // awaitable for a `{data, error}` result.
  const terminal = {
    async then(resolve: (v: unknown) => void) {
      calls.push({ method: 'single' })
      resolve(updateQueue.shift() ?? { data: null, error: null })
    },
  }
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
      return beforeQueue.shift() ?? { data: null, error: null }
    }),
    update(payload: unknown) {
      calls.push({ method: 'update', payload })
      return chain
    },
    insert(payload: unknown) {
      calls.push({ method: 'insert', payload })
      return chain
    },
    single: vi.fn(async () => updateQueue.shift() ?? { data: null, error: null }),
    // The thenable side. `await chain.eq(...)` resolves to the queued
    // update response (the same one `single()` would consume).
    ...terminal,
  }
  return chain
}

const fakeSupabase = {
  from: vi.fn(() => makeChain()),
  auth: {
    getUser: vi.fn(async () => ({
      data: { user: mockUser },
      error: null,
    })),
  },
}
vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: vi.fn(async () => fakeSupabase),
}))

const auditCalls: Array<Record<string, unknown>> = []
vi.mock('./writeSelfAuditLog', () => ({
  writeSelfAuditLog: vi.fn(async (input: Record<string, unknown>) => {
    auditCalls.push(input)
    return 1
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

const { updateProfileAction } = await import('./updateProfile')

const baseValidInput = {
  display_name: 'Klaas Tester',
  bio: 'A short bio.',
  locale: 'en',
  timezone: 'UTC',
  avatar_url: null,
}

beforeEach(() => {
  calls.length = 0
  revalidateCalls.length = 0
  auditCalls.length = 0
  mockWarn.mockClear()
  headerStore.clear()
  beforeQueue = []
  updateQueue = []
  mockUser = { id: 'user-uuid-1', email: 'klaas@example.com' }
  fakeSupabase.from.mockClear()
  fakeSupabase.auth.getUser.mockClear()
  // Re-pin the mock user each test (mockImplementation re-runs each time).
  fakeSupabase.auth.getUser.mockImplementation(async () => ({
    data: { user: mockUser },
    error: null,
  }))
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('updateProfileAction — auth', () => {
  it('returns "Not signed in" when no session user (no DB call)', async () => {
    mockUser = null
    const result = await updateProfileAction(baseValidInput)
    expect(result).toEqual({ ok: false, error: 'Not signed in' })
    expect(fakeSupabase.from).not.toHaveBeenCalled()
    expect(auditCalls).toHaveLength(0)
    expect(revalidateCalls).toHaveLength(0)
  })
})

describe('updateProfileAction — Zod validation (no DB calls)', () => {
  it.each([
    ['empty display_name', { ...baseValidInput, display_name: '' }, 'display_name'],
    ['whitespace-only display_name', { ...baseValidInput, display_name: '   ' }, 'display_name'],
    ['too-long display_name (81 chars)', { ...baseValidInput, display_name: 'x'.repeat(81) }, 'display_name'],
    ['too-long bio (281 chars)', { ...baseValidInput, bio: 'x'.repeat(281) }, 'bio'],
    ['locale too short', { ...baseValidInput, locale: 'e' }, 'locale'],
    ['timezone empty', { ...baseValidInput, timezone: '' }, 'timezone'],
    ['avatar_url non-URL', { ...baseValidInput, avatar_url: 'not-a-url' }, 'avatar_url'],
  ])('rejects invalid input: %s', async (_label, bad, expectedField) => {
    const result = await updateProfileAction(bad)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('Please fix the errors below.')
      expect(result.fieldErrors).toBeDefined()
      expect(result.fieldErrors?.[expectedField]).toBeTruthy()
    }
    expect(fakeSupabase.from).not.toHaveBeenCalled()
    expect(auditCalls).toHaveLength(0)
  })

  it('accepts a valid input and proceeds to DB', async () => {
    beforeQueue.push({ data: null, error: null })
    updateQueue.push({ data: [{ user_id: 'user-uuid-1' }], error: null })
    const result = await updateProfileAction(baseValidInput)
    expect(result.ok).toBe(true)
    expect(fakeSupabase.from).toHaveBeenCalled()
  })

  it('accepts missing optional fields (avatar_url omitted, bio empty)', async () => {
    beforeQueue.push({ data: null, error: null })
    updateQueue.push({ data: [{}], error: null })
    const result = await updateProfileAction({
      display_name: 'Solo',
      bio: '',
      locale: 'en',
      timezone: 'UTC',
    })
    expect(result.ok).toBe(true)
  })
})

describe('updateProfileAction — happy path', () => {
  it('updates row with normalized values (empty bio → null, null avatar_url preserved)', async () => {
    beforeQueue.push({ data: null, error: null }) // no prior row
    updateQueue.push({ data: [{}], error: null })

    await updateProfileAction({
      display_name: 'New Name',
      bio: '',
      locale: 'en',
      timezone: 'UTC',
      avatar_url: null,
    })

    const updateCall = calls.find((c) => c.method === 'update')
    expect(updateCall).toBeDefined()
    expect(updateCall?.method).toBe('update')
    if (updateCall?.method === 'update') {
      expect(updateCall.payload).toEqual({
        display_name: 'New Name',
        bio: null, // empty string normalized to null
        locale: 'en',
        timezone: 'UTC',
        avatar_url: null,
      })
    }
  })

  it('revalidates /account/profile on success', async () => {
    beforeQueue.push({ data: null, error: null })
    updateQueue.push({ data: [{}], error: null })

    await updateProfileAction(baseValidInput)
    expect(revalidateCalls).toContain('/account/profile')
  })

  it('returns ok:true with the normalized profile shape', async () => {
    beforeQueue.push({ data: null, error: null })
    updateQueue.push({ data: [{}], error: null })

    const result = await updateProfileAction({
      display_name: 'Round Trip',
      bio: 'Bio text',
      locale: 'fr',
      timezone: 'Europe/Paris',
      avatar_url: 'https://cdn.example.com/avatars/uuid.png',
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.profile).toEqual({
        display_name: 'Round Trip',
        bio: 'Bio text',
        locale: 'fr',
        timezone: 'Europe/Paris',
        avatar_url: 'https://cdn.example.com/avatars/uuid.png',
      })
    }
  })
})

describe('updateProfileAction — DB error', () => {
  it('returns generic "Could not save" message when update errors', async () => {
    beforeQueue.push({ data: null, error: null })
    updateQueue.push({
      data: null,
      error: { message: 'connection refused' },
    })

    const result = await updateProfileAction(baseValidInput)
    expect(result).toEqual({
      ok: false,
      error: 'Could not save your changes. Please try again.',
    })
    expect(auditCalls).toHaveLength(0)
    expect(revalidateCalls).toHaveLength(0)
  })

  it('logs a warn without leaking the user email or PII in the payload', async () => {
    beforeQueue.push({ data: null, error: null })
    updateQueue.push({ data: null, error: { message: 'connection refused' } })

    await updateProfileAction(baseValidInput)

    expect(mockWarn).toHaveBeenCalledTimes(1)
    const [payload, msg] = mockWarn.mock.calls[0] ?? []
    expect(msg).toBe('profile update failed')
    expect(payload).toEqual({
      code: 'profile_update_failed',
      msg: 'connection refused',
    })
    // The payload must NOT contain the user email or any user_id.
    expect(JSON.stringify(payload)).not.toContain('klaas@example.com')
    expect(JSON.stringify(payload)).not.toContain('user-uuid-1')
  })
})

describe('updateProfileAction — audit log diff', () => {
  it('does NOT write an audit row when nothing changed', async () => {
    beforeQueue.push({
      data: {
        display_name: 'Same',
        bio: 'Same bio',
        locale: 'en',
        timezone: 'UTC',
        avatar_url: null,
      },
      error: null,
    })
    updateQueue.push({ data: [{}], error: null })

    await updateProfileAction({
      display_name: 'Same',
      bio: 'Same bio',
      locale: 'en',
      timezone: 'UTC',
      avatar_url: null,
    })

    expect(auditCalls).toHaveLength(0)
  })

  it('writes audit row with only the changed keys (before + after)', async () => {
    beforeQueue.push({
      data: {
        display_name: 'Old Name',
        bio: 'Old bio',
        locale: 'en',
        timezone: 'UTC',
        avatar_url: null,
      },
      error: null,
    })
    updateQueue.push({ data: [{}], error: null })

    await updateProfileAction({
      display_name: 'New Name',
      bio: 'Old bio',
      locale: 'en',
      timezone: 'UTC',
      avatar_url: null,
    })

    expect(auditCalls).toHaveLength(1)
    const call = auditCalls[0]!
    expect(call.action).toBe('profile_self_update')
    expect(call.targetKind).toBe('profiles')
    expect(call.targetId).toBe('user-uuid-1')
    expect(call.metadata).toEqual({
      before: { display_name: 'Old Name' },
      after: { display_name: 'New Name' },
    })
  })

  it('captures multi-field changes with only the changed keys', async () => {
    beforeQueue.push({
      data: {
        display_name: 'Same',
        bio: 'old',
        locale: 'en',
        timezone: 'UTC',
        avatar_url: null,
      },
      error: null,
    })
    updateQueue.push({ data: [{}], error: null })

    await updateProfileAction({
      display_name: 'Same',
      bio: 'new',
      locale: 'fr',
      timezone: 'UTC',
      avatar_url: null,
    })

    expect(auditCalls).toHaveLength(1)
    expect(auditCalls[0]!.metadata).toEqual({
      before: { bio: 'old', locale: 'en' },
      after: { bio: 'new', locale: 'fr' },
    })
  })

  it('audit metadata contains no email / no PII fields', async () => {
    beforeQueue.push({
      data: {
        display_name: 'A',
        bio: 'B',
        locale: 'en',
        timezone: 'UTC',
        avatar_url: null,
      },
      error: null,
    })
    updateQueue.push({ data: [{}], error: null })

    await updateProfileAction({
      display_name: 'B',
      bio: 'B',
      locale: 'en',
      timezone: 'UTC',
      avatar_url: null,
    })

    const metadata = auditCalls[0]!.metadata as Record<string, Record<string, unknown>>
    const blob = JSON.stringify(metadata)
    expect(blob).not.toContain('email')
    expect(blob).not.toContain('klaas@example.com')
    expect(blob).not.toContain('user-uuid-1')
    expect(blob).not.toContain('password')
  })

  it('forwards the first hop of x-forwarded-for + user-agent to the audit row', async () => {
    beforeQueue.push({
      data: {
        display_name: 'A',
        bio: 'B',
        locale: 'en',
        timezone: 'UTC',
        avatar_url: null,
      },
      error: null,
    })
    updateQueue.push({ data: [{}], error: null })
    headerStore.set('x-forwarded-for', '203.0.113.1, 10.0.0.1, 10.0.0.2')
    headerStore.set('user-agent', 'Mozilla/5.0 (Test)')

    await updateProfileAction({
      display_name: 'B',
      bio: 'B',
      locale: 'en',
      timezone: 'UTC',
      avatar_url: null,
    })

    expect(auditCalls[0]!.ipAddress).toBe('203.0.113.1')
    expect(auditCalls[0]!.userAgent).toBe('Mozilla/5.0 (Test)')
  })

  it('handles missing x-forwarded-for / user-agent headers gracefully (null)', async () => {
    beforeQueue.push({
      data: {
        display_name: 'A',
        bio: 'B',
        locale: 'en',
        timezone: 'UTC',
        avatar_url: null,
      },
      error: null,
    })
    updateQueue.push({ data: [{}], error: null })

    await updateProfileAction({
      display_name: 'B',
      bio: 'B',
      locale: 'en',
      timezone: 'UTC',
      avatar_url: null,
    })

    expect(auditCalls[0]!.ipAddress).toBeNull()
    expect(auditCalls[0]!.userAgent).toBeNull()
  })
})

describe('updateProfileAction — query shape (defensive contract)', () => {
  it('reads the BEFORE row with a PII-safe select payload (no email, no role, no user_id, no created_at)', async () => {
    beforeQueue.push({ data: null, error: null })
    updateQueue.push({ data: [{}], error: null })

    await updateProfileAction(baseValidInput)

    const selectCall = calls.find((c) => c.method === 'select')
    expect(selectCall).toBeDefined()
    if (selectCall?.method === 'select') {
      expect(selectCall.payload).toBe(
        'display_name, bio, locale, timezone, avatar_url',
      )
      // Defense in depth — the explicit field allowlist must NOT include
      // any sensitive columns, even though RLS would block them anyway.
      expect(selectCall.payload).not.toContain('email')
      expect(selectCall.payload).not.toContain('role')
      expect(selectCall.payload).not.toContain('user_id')
      expect(selectCall.payload).not.toContain('created_at')
    }
  })

  it('reads the BEFORE row filtered by user_id', async () => {
    beforeQueue.push({ data: null, error: null })
    updateQueue.push({ data: [{}], error: null })

    await updateProfileAction(baseValidInput)

    const eqCall = calls.find((c) => c.method === 'eq')
    expect(eqCall).toBeDefined()
    if (eqCall?.method === 'eq') {
      expect(eqCall.col).toBe('user_id')
      expect(eqCall.val).toBe('user-uuid-1')
    }
  })

  it('updates the row filtered by user_id (RLS-protected)', async () => {
    beforeQueue.push({ data: null, error: null })
    updateQueue.push({ data: [{}], error: null })

    await updateProfileAction(baseValidInput)

    // The eq after update is the user_id predicate on the update.
    const eqCalls = calls.filter((c) => c.method === 'eq')
    expect(eqCalls.length).toBeGreaterThanOrEqual(2)
    const updateEqs = eqCalls.slice(1) // skip the "before" read eq
    for (const eq of updateEqs) {
      if (eq.method === 'eq') {
        expect(eq.col).toBe('user_id')
        expect(eq.val).toBe('user-uuid-1')
      }
    }
  })
})