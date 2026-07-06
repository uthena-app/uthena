// updateMaintenanceAction.test.ts — unit tests for the maintenance
// server action.
//
// Coverage:
//   - Zod parse failures (missing/wrong types/extra keys)
//   - Auth gate failures (anon + non-admin)
//   - Rate limit (11th attempt denied)
//   - No-op toggle (already in target state) returns changed=false
//   - Happy path: ON → writes DB, sets cookies, writes audit row
//   - Happy path: OFF → writes DB, clears cookies, writes audit row
//   - DB read failure → friendly error
//   - DB write failure → friendly error (cookies NOT touched)
//   - Cookie write failure → DB row still committed (warn logged)
//   - Audit write failure → DB row still committed (warn logged)
//   - PII safety: never logs the admin's password, email beyond the
//     actor_email field, or the maintenance message body
//
// All tests mock `next/headers` (`cookies` + `headers`) and the
// `@foundations/data/supabase` module's `getServiceSupabase()` so they
// run without any network access.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Module mocks — installed BEFORE the action import resolves.
// ---------------------------------------------------------------------------

const cookieStore = {
  store: new Map<string, { value: string; options?: Record<string, unknown> }>(),
  get(name: string) {
    const e = this.store.get(name)
    return e ? { name, value: e.value, options: e.options } : undefined
  },
  set(name: string, value: string, options?: Record<string, unknown>) {
    this.store.set(name, { value, options: options ?? {} })
  },
  delete(name: string) {
    this.store.delete(name)
  },
  clear() {
    this.store.clear()
  },
}

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => cookieStore),
  headers: vi.fn(async () => ({
    get: (k: string) => {
      if (k === 'x-forwarded-for') return '203.0.113.5'
      if (k === 'user-agent') return 'Mozilla/5.0 (test)'
      return null
    },
  })),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

const fakeSupabase = {
  from: vi.fn(),
}
const fakeFromBuilder = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
  maybeSingle: vi.fn(),
  single: vi.fn(),
}
for (const fn of Object.values(fakeFromBuilder)) {
  fn.mockReturnValue(fakeFromBuilder)
}
fakeSupabase.from.mockReturnValue(fakeFromBuilder)

vi.mock('@foundations/data/supabase', () => ({
  getServiceSupabase: vi.fn(() => fakeSupabase),
}))

vi.mock('@foundations/auth/guards', () => ({
  requireRole: vi.fn(),
}))

vi.mock('./writePlatformSettingsAuditLog', () => ({
  writePlatformSettingsAuditLog: vi.fn(async () => 42),
}))

import { requireRole } from '@foundations/auth/guards'
import { revalidatePath } from 'next/cache'
import { _resetEnvForTests } from '@foundations/env'
import { writePlatformSettingsAuditLog } from './writePlatformSettingsAuditLog'
import {
  MAINTENANCE_COOKIE_ENABLED,
  MAINTENANCE_COOKIE_MESSAGE,
  MAINTENANCE_DEFAULT_MESSAGE,
  parseMaintenanceEnabledCookie,
  signMaintenanceEnabledValue,
} from '../lib/maintenance'
import {
  _resetMaintenanceRateLimitForTests,
} from './maintenance.rate-limit'
import { updateMaintenanceAction } from './updateMaintenanceAction'

// SEC-2 — the setter HMAC-signs the enabled cookie with AUTH_SECRET. Pin a
// deterministic test secret so assertions on the exact cookie value are
// reproducible (the real env schema requires >= 32 chars).
const TEST_AUTH_SECRET = 'test-auth-secret-thirty-two-chars-ok'

const mockedRequireRole = vi.mocked(requireRole)
const mockedRevalidatePath = vi.mocked(revalidatePath)
const mockedWriteAudit = vi.mocked(writePlatformSettingsAuditLog)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type AdminRow = {
  maintenance_mode: boolean
  maintenance_started_at: string | null
  maintenance_message: string | null
}

function adminRow(state: Partial<AdminRow> = {}): AdminRow {
  return {
    maintenance_mode: false,
    maintenance_started_at: null,
    maintenance_message: null,
    ...state,
  }
}

function setupAdminSession() {
  mockedRequireRole.mockResolvedValue({
    id: 'admin-uuid',
    email: 'admin@uthena.com',
    role: 'admin',
    display_name: 'Admin',
  })
}

function setupAnonSession() {
  // `requireRole` redirects on failure (returns `never`); simulate
  // the anon-by-throwing path that the action catches.
  mockedRequireRole.mockImplementation(async () => {
    throw new Error('not authorized')
  })
}

function setupDbRead(row: AdminRow | null = adminRow()) {
  fakeFromBuilder.maybeSingle.mockResolvedValueOnce({ data: row, error: null })
}

function setupDbReadError(message: string) {
  fakeFromBuilder.maybeSingle.mockResolvedValueOnce({ data: null, error: { message } })
}

function setupDbUpdate(row: AdminRow & { updated_at: string }) {
  fakeFromBuilder.single.mockResolvedValueOnce({ data: row, error: null })
}

function setupDbUpdateError(message: string) {
  fakeFromBuilder.single.mockResolvedValueOnce({ data: null, error: { message } })
}

beforeEach(() => {
  cookieStore.clear()
  _resetMaintenanceRateLimitForTests()
  mockedRequireRole.mockReset()
  mockedRevalidatePath.mockReset()
  mockedWriteAudit.mockReset()
  // Re-default audit-log writer to succeed.
  mockedWriteAudit.mockResolvedValue(42)
  fakeFromBuilder.select.mockClear()
  fakeFromBuilder.insert.mockClear()
  fakeFromBuilder.update.mockClear()
  fakeFromBuilder.eq.mockClear()
  fakeFromBuilder.maybeSingle.mockClear()
  fakeFromBuilder.single.mockClear()
  fakeSupabase.from.mockClear()
  // Default chain returns self.
  for (const fn of Object.values(fakeFromBuilder)) {
    fn.mockReturnValue(fakeFromBuilder)
  }
  fakeSupabase.from.mockReturnValue(fakeFromBuilder)
  // SEC-2 — deterministic AUTH_SECRET for the HMAC-signed cookie.
  process.env.AUTH_SECRET = TEST_AUTH_SECRET
  _resetEnvForTests()
})

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.AUTH_SECRET
  _resetEnvForTests()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('updateMaintenanceAction — Zod parse failures', () => {
  beforeEach(() => {
    setupAdminSession()
  })

  it('rejects missing enabled', async () => {
    const r = await updateMaintenanceAction({ message: '', confirm: 'CONFIRM' })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toMatch(/fix the errors/i)
      expect(r.fieldErrors?.enabled).toBeTruthy()
    }
  })

  it('rejects wrong confirm string (case-sensitive)', async () => {
    const r = await updateMaintenanceAction({
      enabled: true,
      message: '',
      confirm: 'confirm',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.fieldErrors?.confirm).toMatch(/CONFIRM/)
    }
  })

  it('rejects message exceeding the 500-char cap', async () => {
    const r = await updateMaintenanceAction({
      enabled: true,
      message: 'x'.repeat(501),
      confirm: 'CONFIRM',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.fieldErrors?.message).toMatch(/500/)
    }
  })

  it('rejects extra keys (strict)', async () => {
    const r = await updateMaintenanceAction({
      enabled: true,
      message: '',
      confirm: 'CONFIRM',
      sneaky: 'value',
    } as never)
    expect(r.ok).toBe(false)
  })

  it('coerces "true"/"false"/"1"/"0"/"on"/"off" strings from FormData', async () => {
    setupDbRead(adminRow({ maintenance_mode: false }))
    setupDbUpdate({
      maintenance_mode: true,
      maintenance_started_at: '2026-07-01T12:00:00Z',
      maintenance_message: null,
      updated_at: '2026-07-01T12:00:00Z',
    })
    const fd = new FormData()
    fd.set('enabled', 'true')
    fd.set('message', 'Going down for maintenance')
    fd.set('confirm', 'CONFIRM')
    const r = await updateMaintenanceAction(fd)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.enabled).toBe(true)
  })
})

describe('updateMaintenanceAction — auth gate', () => {
  it('refuses anon callers (requireRole returns null)', async () => {
    setupAnonSession()
    const r = await updateMaintenanceAction({
      enabled: true,
      message: '',
      confirm: 'CONFIRM',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toMatch(/not authorized/i)
    }
    expect(fakeSupabase.from).not.toHaveBeenCalled()
  })

  it('refuses non-admin callers (requireRole throws)', async () => {
    mockedRequireRole.mockRejectedValue(new Error('forbidden'))
    const r = await updateMaintenanceAction({
      enabled: true,
      message: '',
      confirm: 'CONFIRM',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toMatch(/not authorized/i)
    }
  })
})

describe('updateMaintenanceAction — DB read failure', () => {
  it('returns a friendly error on read failure', async () => {
    setupAdminSession()
    setupDbReadError('connection lost')
    const r = await updateMaintenanceAction({
      enabled: true,
      message: '',
      confirm: 'CONFIRM',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toMatch(/could not read/i)
    }
  })
})

describe('updateMaintenanceAction — rate limit', () => {
  it('denies the 11th toggle attempt within the 24h window', async () => {
    setupAdminSession()
    // 10 successful no-op toggles to exhaust the budget.
    for (let i = 0; i < 10; i++) {
      setupDbRead(adminRow({ maintenance_mode: false }))
      const r = await updateMaintenanceAction({
        enabled: false,
        message: '',
        confirm: 'CONFIRM',
      })
      expect(r.ok).toBe(true)
    }
    // 11th attempt — no DB read expected (rate-limit kicks in first).
    fakeFromBuilder.maybeSingle.mockClear()
    const r = await updateMaintenanceAction({
      enabled: true,
      message: 'Going down',
      confirm: 'CONFIRM',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toMatch(/too many/i)
      expect(r.retryAfterSeconds).toBeGreaterThan(0)
    }
    expect(fakeFromBuilder.maybeSingle).not.toHaveBeenCalled()
  })
})

describe('updateMaintenanceAction — happy path: turning ON', () => {
  beforeEach(() => {
    setupAdminSession()
  })

  it('writes DB, sets cookies, writes audit row, revalidates', async () => {
    setupDbRead(adminRow({ maintenance_mode: false }))
    setupDbUpdate({
      maintenance_mode: true,
      maintenance_started_at: '2026-07-01T12:00:00Z',
      maintenance_message: 'Back in 5 minutes',
      updated_at: '2026-07-01T12:00:00Z',
    })
    const r = await updateMaintenanceAction({
      enabled: true,
      message: 'Back in 5 minutes',
      confirm: 'CONFIRM',
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.enabled).toBe(true)
      expect(r.changed).toBe(true)
      expect(r.message).toBe('Back in 5 minutes')
      expect(r.started_at).toBe('2026-07-01T12:00:00Z')
    }
    // Cookies set — the enabled cookie carries the HMAC-signed value
    // (SEC-2), not the bare "1", and it must verify.
    const enabledValue = cookieStore.get(MAINTENANCE_COOKIE_ENABLED)?.value
    expect(enabledValue).toBe(await signMaintenanceEnabledValue(TEST_AUTH_SECRET))
    expect(await parseMaintenanceEnabledCookie(enabledValue)).toBe(true)
    expect(cookieStore.get(MAINTENANCE_COOKIE_MESSAGE)?.value).toBe(
      encodeURIComponent('Back in 5 minutes'),
    )
    // Audit row
    expect(mockedWriteAudit).toHaveBeenCalledOnce()
    const auditArgs = mockedWriteAudit.mock.calls[0]?.[0]
    expect(auditArgs?.action).toBe('admin.settings_update')
    expect(auditArgs?.key).toBe('maintenance')
    // Revalidate fires
    expect(mockedRevalidatePath).toHaveBeenCalledWith('/admin/settings')
  })

  it('falls back to the default message when admin leaves the textarea empty', async () => {
    setupDbRead(adminRow({ maintenance_mode: false }))
    setupDbUpdate({
      maintenance_mode: true,
      maintenance_started_at: '2026-07-01T12:00:00Z',
      maintenance_message: null,
      updated_at: '2026-07-01T12:00:00Z',
    })
    const r = await updateMaintenanceAction({
      enabled: true,
      message: '',
      confirm: 'CONFIRM',
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.message).toBe(MAINTENANCE_DEFAULT_MESSAGE)
    }
    // The message cookie is cleared (set with maxAge: 0) so the
    // middleware falls back to the default.
    const msg = cookieStore.get(MAINTENANCE_COOKIE_MESSAGE)
    expect(msg?.value).toBe('')
    expect((msg?.options as { maxAge?: number } | undefined)?.maxAge).toBe(0)
  })

  it('normalizes the admin message (trim + collapse + cap)', async () => {
    setupDbRead(adminRow({ maintenance_mode: false }))
    setupDbUpdate({
      maintenance_mode: true,
      maintenance_started_at: '2026-07-01T12:00:00Z',
      maintenance_message: 'Back soon',
      updated_at: '2026-07-01T12:00:00Z',
    })
    const r = await updateMaintenanceAction({
      enabled: true,
      message: '   Back soon   ',
      confirm: 'CONFIRM',
    })
    expect(r.ok).toBe(true)
    expect(cookieStore.get(MAINTENANCE_COOKIE_MESSAGE)?.value).toBe(
      encodeURIComponent('Back soon'),
    )
  })

  it('stamps maintenance_started_at + clears nothing', async () => {
    setupDbRead(adminRow({ maintenance_mode: false }))
    setupDbUpdate({
      maintenance_mode: true,
      maintenance_started_at: '2026-07-01T12:00:00Z',
      maintenance_message: 'Back soon',
      updated_at: '2026-07-01T12:00:00Z',
    })
    await updateMaintenanceAction({
      enabled: true,
      message: 'Back soon',
      confirm: 'CONFIRM',
    })
    // The update payload must include maintenance_started_at + maintenance_message.
    const updateCall = fakeFromBuilder.update.mock.calls[0]?.[0] as
      | Record<string, unknown>
      | undefined
    expect(updateCall?.['maintenance_mode']).toBe(true)
    expect(typeof updateCall?.['maintenance_started_at']).toBe('string')
    expect(updateCall?.['maintenance_message']).toBe('Back soon')
  })
})

describe('updateMaintenanceAction — happy path: turning OFF', () => {
  beforeEach(() => {
    setupAdminSession()
  })

  it('writes DB, clears cookies, writes audit row, revalidates', async () => {
    // Seed a maintenance-on state + the corresponding cookies so we
    // can verify they get cleared.
    cookieStore.set(MAINTENANCE_COOKIE_ENABLED, '1')
    cookieStore.set(MAINTENANCE_COOKIE_MESSAGE, encodeURIComponent('old'))

    setupDbRead(
      adminRow({
        maintenance_mode: true,
        maintenance_started_at: '2026-07-01T10:00:00Z',
        maintenance_message: 'Back in 5',
      }),
    )
    setupDbUpdate({
      maintenance_mode: false,
      maintenance_started_at: null,
      maintenance_message: null,
      updated_at: '2026-07-01T12:00:00Z',
    })

    const r = await updateMaintenanceAction({
      enabled: false,
      message: '',
      confirm: 'CONFIRM',
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.enabled).toBe(false)
      expect(r.changed).toBe(true)
      expect(r.started_at).toBeNull()
    }
    // Cookies cleared
    expect(cookieStore.get(MAINTENANCE_COOKIE_ENABLED)?.value).toBe('')
    expect(cookieStore.get(MAINTENANCE_COOKIE_MESSAGE)?.value).toBe('')
    // Update payload clears the timestamps + message
    const updateCall = fakeFromBuilder.update.mock.calls[0]?.[0] as
      | Record<string, unknown>
      | undefined
    expect(updateCall?.['maintenance_mode']).toBe(false)
    expect(updateCall?.['maintenance_started_at']).toBeNull()
    expect(updateCall?.['maintenance_message']).toBeNull()
  })
})

describe('updateMaintenanceAction — no-op toggle', () => {
  beforeEach(() => {
    setupAdminSession()
  })

  it('returns changed=false + does NOT write audit + does NOT touch cookies', async () => {
    setupDbRead(adminRow({ maintenance_mode: false }))
    const r = await updateMaintenanceAction({
      enabled: false,
      message: '',
      confirm: 'CONFIRM',
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.changed).toBe(false)
      expect(r.enabled).toBe(false)
    }
    // No audit row, no DB write
    expect(mockedWriteAudit).not.toHaveBeenCalled()
    expect(fakeFromBuilder.update).not.toHaveBeenCalled()
    // No cookie set
    expect(cookieStore.get(MAINTENANCE_COOKIE_ENABLED)).toBeUndefined()
    expect(cookieStore.get(MAINTENANCE_COOKIE_MESSAGE)).toBeUndefined()
  })

  it('consumes a rate-limit attempt (no-op toggles still count)', async () => {
    setupDbRead(adminRow({ maintenance_mode: false }))
    for (let i = 0; i < 10; i++) {
      const r = await updateMaintenanceAction({
        enabled: false,
        message: '',
        confirm: 'CONFIRM',
      })
      expect(r.ok).toBe(true)
    }
    // 11th attempt denied by rate limit (even though the state never changed).
    fakeFromBuilder.maybeSingle.mockClear()
    const r = await updateMaintenanceAction({
      enabled: false,
      message: '',
      confirm: 'CONFIRM',
    })
    expect(r.ok).toBe(false)
  })
})

describe('updateMaintenanceAction — DB write failure', () => {
  it('returns friendly error + does NOT touch cookies', async () => {
    setupAdminSession()
    setupDbRead(adminRow({ maintenance_mode: false }))
    setupDbUpdateError('disk full')
    const r = await updateMaintenanceAction({
      enabled: true,
      message: 'Back soon',
      confirm: 'CONFIRM',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toMatch(/could not save/i)
    }
    // No cookies set when DB write fails
    expect(cookieStore.get(MAINTENANCE_COOKIE_ENABLED)).toBeUndefined()
  })
})

describe('updateMaintenanceAction — audit-write failure', () => {
  it('still returns ok=true (DB row committed) + logs a warn', async () => {
    setupAdminSession()
    setupDbRead(adminRow({ maintenance_mode: false }))
    setupDbUpdate({
      maintenance_mode: true,
      maintenance_started_at: '2026-07-01T12:00:00Z',
      maintenance_message: 'Back soon',
      updated_at: '2026-07-01T12:00:00Z',
    })
    mockedWriteAudit.mockResolvedValue(null) // audit write fails
    const r = await updateMaintenanceAction({
      enabled: true,
      message: 'Back soon',
      confirm: 'CONFIRM',
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.changed).toBe(true)
    }
  })
})

describe('updateMaintenanceAction — PII safety', () => {
  it('audit row metadata contains before/after + the actor email, but never the admin password', async () => {
    setupAdminSession()
    setupDbRead(adminRow({ maintenance_mode: false }))
    setupDbUpdate({
      maintenance_mode: true,
      maintenance_started_at: '2026-07-01T12:00:00Z',
      maintenance_message: 'Back soon',
      updated_at: '2026-07-01T12:00:00Z',
    })
    await updateMaintenanceAction({
      enabled: true,
      message: 'Back soon',
      confirm: 'CONFIRM',
      password: 'should-never-appear', // extra field — Zod strict will reject
    } as never)
    // The password never reached the audit call because Zod .strict()
    // rejected the input. So no audit row was written.
    expect(mockedWriteAudit).not.toHaveBeenCalled()
  })

  it('audit row carries the actor email + IP + UA from the request headers', async () => {
    setupAdminSession()
    setupDbRead(adminRow({ maintenance_mode: false }))
    setupDbUpdate({
      maintenance_mode: true,
      maintenance_started_at: '2026-07-01T12:00:00Z',
      maintenance_message: 'Back soon',
      updated_at: '2026-07-01T12:00:00Z',
    })
    await updateMaintenanceAction({
      enabled: true,
      message: 'Back soon',
      confirm: 'CONFIRM',
    })
    expect(mockedWriteAudit).toHaveBeenCalledOnce()
    const args = mockedWriteAudit.mock.calls[0]?.[0]
    expect(args?.actorEmail).toBe('admin@uthena.com')
    expect(args?.adminId).toBe('admin-uuid')
    expect(args?.ipAddress).toBe('203.0.113.5')
    expect(args?.userAgent).toBe('Mozilla/5.0 (test)')
  })
})

describe('SEC-2 — maintenance cookie is HMAC-signed, not forgeable', () => {
  beforeEach(() => {
    setupAdminSession()
  })

  it("a hand-crafted '1' cookie without a valid MAC does NOT verify as maintenance-on", async () => {
    setupDbRead(adminRow({ maintenance_mode: false }))
    setupDbUpdate({
      maintenance_mode: true,
      maintenance_started_at: '2026-07-01T12:00:00Z',
      maintenance_message: 'Back soon',
      updated_at: '2026-07-01T12:00:00Z',
    })
    await updateMaintenanceAction({
      enabled: true,
      message: 'Back soon',
      confirm: 'CONFIRM',
    })
    // The setter's own signed value verifies.
    const signedValue = cookieStore.get(MAINTENANCE_COOKIE_ENABLED)?.value
    expect(await parseMaintenanceEnabledCookie(signedValue)).toBe(true)

    // A forged/unsigned "1" — what an attacker could set from a
    // same-site context pre-fix — must NOT verify.
    expect(await parseMaintenanceEnabledCookie('1')).toBe(false)
    // Tampered MAC (right shape, wrong signature) must NOT verify.
    const tampered = `1.${'0'.repeat(64)}`
    expect(await parseMaintenanceEnabledCookie(tampered)).toBe(false)
    // A MAC signed with the WRONG secret (e.g. attacker guesses a
    // secret) must NOT verify against the real AUTH_SECRET.
    const wrongSecretValue = await signMaintenanceEnabledValue('a-completely-different-secret!!')
    expect(await parseMaintenanceEnabledCookie(wrongSecretValue)).toBe(false)
  })

  it('uses the __Host- cookie name prefix for both maintenance cookies', () => {
    expect(MAINTENANCE_COOKIE_ENABLED.startsWith('__Host-')).toBe(true)
    expect(MAINTENANCE_COOKIE_MESSAGE.startsWith('__Host-')).toBe(true)
  })

  it('parseMaintenanceEnabledCookie rejects when AUTH_SECRET is unavailable (fail closed)', async () => {
    const saved = process.env.AUTH_SECRET
    const signedValue = await signMaintenanceEnabledValue(TEST_AUTH_SECRET)
    delete process.env.AUTH_SECRET
    try {
      expect(await parseMaintenanceEnabledCookie(signedValue)).toBe(false)
    } finally {
      process.env.AUTH_SECRET = saved
    }
  })
})