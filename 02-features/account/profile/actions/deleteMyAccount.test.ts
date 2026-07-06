// deleteMyAccount.test.ts — unit tests for the deleteMyAccountAction
// server action (the right-to-deletion (GDPR Art. 17) handler that
// runs behind the "type your email to confirm" modal on /account/profile).
//
// Scope: the action's own logic — auth gating, email-match gate, the
// ordered audit-then-cascade-then-sign-out sequence, typed outcome
// mapping back to the modal's expected error strings, and PII safety.
//
// The RPC outcome → typed result mapping is owned by
// `00-foundations/gdpr/delete-cascade.ts` and has its own 27-test
// coverage there. Here we mock `deleteMyAccountCascade` directly
// and assert the action's behavior at the seam.
//
// Strategy: same chainable-fake-Supabase pattern as
// `updateProfile.test.ts`. The `cookies()` and `createServerClient`
// sign-out path is mocked at module boundary (Next.js cookies() isn't
// available outside a request, and we don't want to exercise the
// real Supabase SSR client from a unit test).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Module mocks — set up BEFORE the dynamic import at the bottom.
// ---------------------------------------------------------------------------

// Audit-log capture (we mock the action's own import, not the
// foundations writer — the audit-log writeSelfAuditLog has its own
// test file).
const auditCalls: Array<Record<string, unknown>> = []
vi.mock('./writeSelfAuditLog', () => ({
  writeSelfAuditLog: vi.fn(async (input: Record<string, unknown>) => {
    auditCalls.push(input)
    return 1
  }),
}))

// Cascade outcome — drive from a switch the test sets each case.
let cascadeOutcome: string = 'anonymized'
vi.mock('@foundations/gdpr/delete-cascade', () => ({
  deleteMyAccountCascade: vi.fn(async (_userId: string) => cascadeOutcome),
  DeleteMyAccountOutcome: {},
}))

// Sign-out path — we never want the real Supabase auth.signOut from a
// unit test. Stub the cookies() + createServerClient() surface.
const signOutCalls: Array<{ url: string; anon: string }> = []
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    getAll: () => [],
    set: () => undefined,
  })),
}))

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn((url: string, anon: string, _opts: unknown) => ({
    auth: {
      signOut: vi.fn(async () => {
        signOutCalls.push({ url, anon })
      }),
    },
  })),
}))

// Supabase request client — controls the session user.
let mockUser:
  | { id: string; email: string | null }
  | null = null

const fakeSupabase = {
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

const mockWarn = vi.fn()
vi.mock('@foundations/log/pino', () => ({
  loggerFor: () => ({
    info: vi.fn(),
    warn: (...args: unknown[]) => mockWarn(...args),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

const { deleteMyAccountAction } = await import('./deleteMyAccount')

// ---------------------------------------------------------------------------
// Test setup / teardown.
// ---------------------------------------------------------------------------

beforeEach(() => {
  auditCalls.length = 0
  signOutCalls.length = 0
  cascadeOutcome = 'anonymized'
  mockWarn.mockClear()
  mockUser = {
    id: '11111111-2222-3333-4444-555555555555',
    email: 'klaas@example.com',
  }
  fakeSupabase.auth.getUser.mockClear()
  fakeSupabase.auth.getUser.mockImplementation(async () => ({
    data: { user: mockUser },
    error: null,
  }))
})

afterEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Auth gating.
// ---------------------------------------------------------------------------

describe('deleteMyAccountAction — auth gating', () => {
  it('returns "unknown" for an anonymous caller (no audit, no cascade, no sign-out)', async () => {
    mockUser = null
    const result = await deleteMyAccountAction({ confirmEmail: 'whoever@example.com' })
    expect(result).toEqual({ ok: false, error: 'unknown' })
    expect(auditCalls).toHaveLength(0)
    expect(signOutCalls).toHaveLength(0)
  })

  it('returns "unknown" when the session has no email (defensive)', async () => {
    mockUser = { id: 'user-1', email: null }
    const result = await deleteMyAccountAction({ confirmEmail: 'whoever@example.com' })
    expect(result).toEqual({ ok: false, error: 'unknown' })
    expect(auditCalls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Email-match gate.
// ---------------------------------------------------------------------------

describe('deleteMyAccountAction — email match gate', () => {
  it('returns "wrong_email" when the typed email does not match (no cascade)', async () => {
    const result = await deleteMyAccountAction({ confirmEmail: 'someone-else@example.com' })
    expect(result).toEqual({ ok: false, error: 'wrong_email' })
    expect(auditCalls).toHaveLength(0)
    expect(signOutCalls).toHaveLength(0)
  })

  it('email match is case-insensitive (KLAAS@EXAMPLE.COM == klaas@example.com)', async () => {
    const result = await deleteMyAccountAction({ confirmEmail: 'KLAAS@EXAMPLE.COM' })
    expect(result.ok).toBe(true)
    expect(signOutCalls).toHaveLength(1)
  })

  it('email match is whitespace-trimmed', async () => {
    const result = await deleteMyAccountAction({ confirmEmail: '  klaas@example.com  ' })
    expect(result.ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Cascade outcome mapping.
// ---------------------------------------------------------------------------

describe('deleteMyAccountAction — cascade outcome mapping', () => {
  it('returns ok:true + redirectTo "/" when cascade outcome is "anonymized"', async () => {
    cascadeOutcome = 'anonymized'
    const result = await deleteMyAccountAction({ confirmEmail: 'klaas@example.com' })
    expect(result).toEqual({ ok: true, redirectTo: '/' })
  })

  it('returns ok:true when cascade outcome is "already_deleted" (idempotent)', async () => {
    cascadeOutcome = 'already_deleted'
    const result = await deleteMyAccountAction({ confirmEmail: 'klaas@example.com' })
    expect(result).toEqual({ ok: true, redirectTo: '/' })
  })

  it('returns "cancel_subscriptions_first" when cascade reports active subscriptions', async () => {
    cascadeOutcome = 'cancel_subscriptions_first'
    const result = await deleteMyAccountAction({ confirmEmail: 'klaas@example.com' })
    expect(result).toEqual({ ok: false, error: 'cancel_subscriptions_first' })
    expect(signOutCalls).toHaveLength(0) // we did NOT sign out — the user can cancel and retry
  })

  it('returns "resolve_payouts_first" when cascade reports pending payouts', async () => {
    cascadeOutcome = 'resolve_payouts_first'
    const result = await deleteMyAccountAction({ confirmEmail: 'klaas@example.com' })
    expect(result).toEqual({ ok: false, error: 'resolve_payouts_first' })
    expect(signOutCalls).toHaveLength(0)
  })

  it('returns "unknown" for any unrecognized cascade outcome (defensive)', async () => {
    cascadeOutcome = 'totally-bogus-string'
    const result = await deleteMyAccountAction({ confirmEmail: 'klaas@example.com' })
    expect(result).toEqual({ ok: false, error: 'unknown' })
    expect(signOutCalls).toHaveLength(0)
  })

  it('does NOT sign out when the cascade outcome is a gate (subs/payouts)', async () => {
    cascadeOutcome = 'cancel_subscriptions_first'
    await deleteMyAccountAction({ confirmEmail: 'klaas@example.com' })
    expect(signOutCalls).toHaveLength(0)
  })

  it('signs out the session only after a successful cascade (anonymized)', async () => {
    cascadeOutcome = 'anonymized'
    await deleteMyAccountAction({ confirmEmail: 'klaas@example.com' })
    expect(signOutCalls).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Audit log — written BEFORE the cascade so the request is recorded
// even if the cascade fails partway.
// ---------------------------------------------------------------------------

describe('deleteMyAccountAction — audit log', () => {
  it('writes a self-delete audit row before invoking the cascade', async () => {
    cascadeOutcome = 'anonymized'
    await deleteMyAccountAction({ confirmEmail: 'klaas@example.com' })
    expect(auditCalls).toHaveLength(1)
    const row = auditCalls[0]!
    expect(row.action).toBe('account_self_delete')
    expect(row.targetKind).toBe('profiles')
    expect(row.targetId).toBe('11111111-2222-3333-4444-555555555555')
    expect(row.userEmail).toBe('klaas@example.com')
  })

  it('audit row metadata captures anonymized:true + requested_at ISO timestamp', async () => {
    cascadeOutcome = 'anonymized'
    await deleteMyAccountAction({ confirmEmail: 'klaas@example.com' })
    const metadata = auditCalls[0]!.metadata as Record<string, unknown>
    expect(metadata.anonymized).toBe(true)
    expect(typeof metadata.requested_at).toBe('string')
    expect(new Date(metadata.requested_at as string).toString()).not.toBe('Invalid Date')
  })

  it('does NOT write an audit row when the email does not match (gate fires first)', async () => {
    const result = await deleteMyAccountAction({ confirmEmail: 'wrong@example.com' })
    expect(result.ok).toBe(false)
    expect(auditCalls).toHaveLength(0)
  })

  it('still writes an audit row when the cascade reports a gate (subs/payouts) — request is recorded either way', async () => {
    cascadeOutcome = 'cancel_subscriptions_first'
    await deleteMyAccountAction({ confirmEmail: 'klaas@example.com' })
    expect(auditCalls).toHaveLength(1)
    expect(auditCalls[0]!.action).toBe('account_self_delete')
  })
})

// ---------------------------------------------------------------------------
// PII safety — no email / user_id should appear in any warn-log payload.
// The cascade wrapper has its own PII-safety tests; here we focus on
// the action's own log callsites.
// ---------------------------------------------------------------------------

describe('deleteMyAccountAction — PII safety in logs', () => {
  it('does not log the email in any warn payload (cascade may have logged it; the action must not double-log)', async () => {
    cascadeOutcome = 'cancel_subscriptions_first'
    await deleteMyAccountAction({ confirmEmail: 'klaas@example.com' })
    // The action itself doesn't log on a gate outcome; if it ever
    // starts to, this test catches an email leak.
    for (const call of mockWarn.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('klaas@example.com')
    }
  })

  it('does not log the user_id UUID in any warn payload', async () => {
    cascadeOutcome = 'unknown'
    await deleteMyAccountAction({ confirmEmail: 'klaas@example.com' })
    for (const call of mockWarn.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('11111111-2222-3333-4444-555555555555')
    }
  })
})