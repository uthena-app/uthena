// maintenance.test.ts — unit tests for the pure maintenance-mode contract.
//
// Coverage:
//   - Constants are exported and match the spec (cookie names, TTL,
//     message caps, confirm string).
//   - Schema + coercer — defensive parsing of the DB row.
//   - Cookie parsers — enabled boolean + URL-encoded message.
//   - Normalizer — trim + collapse + cap the admin message.
//   - Formatters — message + timestamp display.
//   - Cookie secure flag — env-driven resolver.
//   - Rate limit verdict — sliding-window allow/deny.
//   - Pure edge cases — never throws, always returns a usable value.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  MAINTENANCE_CONFIRM,
  MAINTENANCE_COOKIE_ENABLED,
  MAINTENANCE_COOKIE_MESSAGE,
  MAINTENANCE_COOKIE_TTL_SECONDS,
  MAINTENANCE_DEFAULT_MESSAGE,
  MAINTENANCE_MESSAGE_DB_MAX,
  MAINTENANCE_MESSAGE_MAX,
  MAINTENANCE_PATH_EXEMPT_PREFIXES,
  MAINTENANCE_TOGGLE_RATE_LIMIT_MAX,
  MAINTENANCE_TOGGLE_RATE_LIMIT_WINDOW_MS,
  MaintenanceActionInputSchema,
  MaintenanceDbRowSchema,
  MaintenanceStateSchema,
  coerceMaintenanceState,
  formatMaintenanceMessage,
  formatMaintenanceTimestamp,
  hmacMaintenanceValue,
  maintenanceEnabledCookieOptions,
  maintenanceMessageCookieOptions,
  normalizeMaintenanceMessage,
  parseMaintenanceEnabledCookie,
  parseMaintenanceMessageCookie,
  rateLimitVerdict,
  resolveMaintenanceCookieSecure,
  signMaintenanceEnabledValue,
} from './maintenance'

const TEST_AUTH_SECRET = 'test-auth-secret-32-chars-min!!'

describe('maintenance constants', () => {
  it('exports the typed-CONFIRM string', () => {
    expect(MAINTENANCE_CONFIRM).toBe('CONFIRM')
  })

  it('exports the cookie names verbatim, with the __Host- prefix (SEC-2)', () => {
    expect(MAINTENANCE_COOKIE_ENABLED).toBe('__Host-uthena_maintenance_enabled')
    expect(MAINTENANCE_COOKIE_MESSAGE).toBe('__Host-uthena_maintenance_message')
  })

  it('uses 60s cookie TTL per the spec (Maintenance-mode cache invalidation)', () => {
    expect(MAINTENANCE_COOKIE_TTL_SECONDS).toBe(60)
  })

  it('caps the message at 500 chars at the action layer (single-screen friendly)', () => {
    expect(MAINTENANCE_MESSAGE_MAX).toBe(500)
  })

  it('caps the message at 1000 chars at the DB layer (headroom)', () => {
    expect(MAINTENANCE_MESSAGE_DB_MAX).toBe(1000)
  })

  it('exports the fallback message', () => {
    expect(MAINTENANCE_DEFAULT_MESSAGE).toMatch(/scheduled maintenance/i)
    expect(MAINTENANCE_DEFAULT_MESSAGE.length).toBeGreaterThan(10)
  })

  it('exempts /admin/ and /maintenance from the 503', () => {
    expect(MAINTENANCE_PATH_EXEMPT_PREFIXES).toContain('/admin/')
    expect(MAINTENANCE_PATH_EXEMPT_PREFIXES).toContain('/maintenance')
  })

  it('enforces 10 toggles per 24h (spec line 126)', () => {
    expect(MAINTENANCE_TOGGLE_RATE_LIMIT_MAX).toBe(10)
    expect(MAINTENANCE_TOGGLE_RATE_LIMIT_WINDOW_MS).toBe(24 * 60 * 60 * 1000)
  })
})

describe('MaintenanceActionInputSchema', () => {
  it('accepts the canonical happy-path input', () => {
    const r = MaintenanceActionInputSchema.safeParse({
      enabled: true,
      message: 'Back in 5 minutes.',
      confirm: 'CONFIRM',
    })
    expect(r.success).toBe(true)
  })

  it('rejects the wrong confirm string', () => {
    const r = MaintenanceActionInputSchema.safeParse({
      enabled: true,
      message: 'Back in 5 minutes.',
      confirm: 'confirm', // case-sensitive
    })
    expect(r.success).toBe(false)
  })

  it('rejects an empty confirm string', () => {
    const r = MaintenanceActionInputSchema.safeParse({
      enabled: true,
      message: 'Back in 5 minutes.',
      confirm: '',
    })
    expect(r.success).toBe(false)
  })

  it('accepts an empty message (falls back to the default on display)', () => {
    const r = MaintenanceActionInputSchema.safeParse({
      enabled: true,
      message: '',
      confirm: 'CONFIRM',
    })
    expect(r.success).toBe(true)
  })

  it('rejects a message that exceeds the 500-char cap', () => {
    const r = MaintenanceActionInputSchema.safeParse({
      enabled: true,
      message: 'x'.repeat(501),
      confirm: 'CONFIRM',
    })
    expect(r.success).toBe(false)
  })

  it('accepts a message at exactly 500 chars', () => {
    const r = MaintenanceActionInputSchema.safeParse({
      enabled: false,
      message: 'x'.repeat(500),
      confirm: 'CONFIRM',
    })
    expect(r.success).toBe(true)
  })

  it('rejects extra keys (strict)', () => {
    const r = MaintenanceActionInputSchema.safeParse({
      enabled: true,
      message: '',
      confirm: 'CONFIRM',
      extra: 'nope',
    })
    expect(r.success).toBe(false)
  })

  it('rejects non-boolean enabled', () => {
    const r = MaintenanceActionInputSchema.safeParse({
      enabled: 'yes',
      message: '',
      confirm: 'CONFIRM',
    })
    expect(r.success).toBe(false)
  })

  it('rejects missing enabled', () => {
    const r = MaintenanceActionInputSchema.safeParse({
      message: '',
      confirm: 'CONFIRM',
    })
    expect(r.success).toBe(false)
  })
})

describe('MaintenanceDbRowSchema', () => {
  it('accepts a valid DB row shape', () => {
    const r = MaintenanceDbRowSchema.safeParse({
      maintenance_mode: true,
      maintenance_started_at: '2026-07-01T12:00:00Z',
      maintenance_message: 'Back soon',
    })
    expect(r.success).toBe(true)
  })

  it('accepts null for the optional columns', () => {
    const r = MaintenanceDbRowSchema.safeParse({
      maintenance_mode: false,
      maintenance_started_at: null,
      maintenance_message: null,
    })
    expect(r.success).toBe(true)
  })

  it('rejects unknown extra keys (strict)', () => {
    const r = MaintenanceDbRowSchema.strict().safeParse({
      maintenance_mode: false,
      maintenance_started_at: null,
      maintenance_message: null,
      sneaky: true,
    })
    expect(r.success).toBe(false)
  })

  it('rejects non-boolean maintenance_mode', () => {
    const r = MaintenanceDbRowSchema.safeParse({
      maintenance_mode: 'yes',
      maintenance_started_at: null,
      maintenance_message: null,
    })
    expect(r.success).toBe(false)
  })
})

describe('coerceMaintenanceState', () => {
  it('returns the off + default-message state on non-object input', () => {
    expect(coerceMaintenanceState(null)).toEqual({
      enabled: false,
      started_at: null,
      message: MAINTENANCE_DEFAULT_MESSAGE,
    })
    expect(coerceMaintenanceState(undefined)).toEqual({
      enabled: false,
      started_at: null,
      message: MAINTENANCE_DEFAULT_MESSAGE,
    })
    expect(coerceMaintenanceState('not an object')).toEqual({
      enabled: false,
      started_at: null,
      message: MAINTENANCE_DEFAULT_MESSAGE,
    })
  })

  it('returns the off + default-message state when columns are missing', () => {
    expect(coerceMaintenanceState({})).toEqual({
      enabled: false,
      started_at: null,
      message: MAINTENANCE_DEFAULT_MESSAGE,
    })
  })

  it('maps maintenance_mode=false to enabled=false', () => {
    expect(coerceMaintenanceState({
      maintenance_mode: false,
      maintenance_started_at: null,
      maintenance_message: 'Back soon',
    })).toEqual({
      enabled: false,
      started_at: null,
      message: 'Back soon',
    })
  })

  it('maps maintenance_mode=true + valid started_at to enabled=true', () => {
    const r = coerceMaintenanceState({
      maintenance_mode: true,
      maintenance_started_at: '2026-07-01T12:00:00Z',
      maintenance_message: 'Back in 5 minutes.',
    })
    expect(r.enabled).toBe(true)
    expect(r.started_at).toBe('2026-07-01T12:00:00Z')
    expect(r.message).toBe('Back in 5 minutes.')
  })

  it('falls back to default message when DB message is empty / whitespace', () => {
    expect(coerceMaintenanceState({
      maintenance_mode: false,
      maintenance_started_at: null,
      maintenance_message: '   ',
    }).message).toBe(MAINTENANCE_DEFAULT_MESSAGE)

    expect(coerceMaintenanceState({
      maintenance_mode: false,
      maintenance_started_at: null,
      maintenance_message: '',
    }).message).toBe(MAINTENANCE_DEFAULT_MESSAGE)
  })

  it('trims surrounding whitespace from the message', () => {
    expect(coerceMaintenanceState({
      maintenance_mode: false,
      maintenance_started_at: null,
      maintenance_message: '  Back soon  ',
    }).message).toBe('Back soon')
  })
})

describe('hmacMaintenanceValue', () => {
  it('is deterministic for the same payload + secret', async () => {
    expect(await hmacMaintenanceValue('1', TEST_AUTH_SECRET)).toBe(await hmacMaintenanceValue('1', TEST_AUTH_SECRET))
  })

  it('differs when the secret differs', async () => {
    expect(await hmacMaintenanceValue('1', TEST_AUTH_SECRET)).not.toBe(
      await hmacMaintenanceValue('1', 'a-different-secret-entirely!!!!'),
    )
  })

  it('returns a 64-char lowercase hex digest (SHA-256)', async () => {
    const mac = await hmacMaintenanceValue('1', TEST_AUTH_SECRET)
    expect(mac).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('signMaintenanceEnabledValue', () => {
  it('produces "1.<64-hex-char-mac>"', async () => {
    const value = await signMaintenanceEnabledValue(TEST_AUTH_SECRET)
    expect(value).toMatch(/^1\.[0-9a-f]{64}$/)
  })
})

describe('parseMaintenanceEnabledCookie — SEC-2 HMAC verification', () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = TEST_AUTH_SECRET
  })

  afterEach(() => {
    delete process.env.AUTH_SECRET
  })

  it('resolves true for a correctly signed value', async () => {
    const signed = await signMaintenanceEnabledValue(TEST_AUTH_SECRET)
    expect(await parseMaintenanceEnabledCookie(signed)).toBe(true)
  })

  it("rejects the bare literal '1' (unsigned — the pre-SEC-2 forgeable shape)", async () => {
    expect(await parseMaintenanceEnabledCookie('1')).toBe(false)
  })

  it('rejects every other unsigned value', async () => {
    expect(await parseMaintenanceEnabledCookie('0')).toBe(false)
    expect(await parseMaintenanceEnabledCookie('true')).toBe(false)
    expect(await parseMaintenanceEnabledCookie('yes')).toBe(false)
    expect(await parseMaintenanceEnabledCookie('')).toBe(false)
    expect(await parseMaintenanceEnabledCookie(null)).toBe(false)
    expect(await parseMaintenanceEnabledCookie(undefined)).toBe(false)
    expect(await parseMaintenanceEnabledCookie(1)).toBe(false)
    expect(await parseMaintenanceEnabledCookie({})).toBe(false)
  })

  it('rejects a tampered MAC (right shape, wrong signature)', async () => {
    expect(await parseMaintenanceEnabledCookie(`1.${'0'.repeat(64)}`)).toBe(false)
  })

  it('rejects a value signed with a different secret', async () => {
    const wrongSecretValue = await signMaintenanceEnabledValue('a-completely-different-secret!!')
    expect(await parseMaintenanceEnabledCookie(wrongSecretValue)).toBe(false)
  })

  it('rejects a malformed MAC (not 64 hex chars)', async () => {
    expect(await parseMaintenanceEnabledCookie('1.notahexstring')).toBe(false)
    expect(await parseMaintenanceEnabledCookie('1.')).toBe(false)
  })

  it('rejects a value with the wrong payload prefix', async () => {
    expect(await parseMaintenanceEnabledCookie(`2.${await hmacMaintenanceValue('2', TEST_AUTH_SECRET)}`)).toBe(false)
  })

  it('fails closed when AUTH_SECRET is unavailable', async () => {
    const signed = await signMaintenanceEnabledValue(TEST_AUTH_SECRET)
    delete process.env.AUTH_SECRET
    expect(await parseMaintenanceEnabledCookie(signed)).toBe(false)
  })
})

describe('parseMaintenanceMessageCookie', () => {
  it('decodes URL-encoded ASCII messages', () => {
    expect(parseMaintenanceMessageCookie('Back%20soon')).toBe('Back soon')
  })

  it('decodes URL-encoded Unicode messages (emoji + accented chars)', () => {
    // 'Bérié café' = B + é (U+00E9) + r + i + é + space + c + a + f + é
    // é in UTF-8 is 0xC3 0xA9
    expect(parseMaintenanceMessageCookie('B%C3%A9ri%C3%A9%20caf%C3%A9')).toBe('Bérié café')
  })

  it('returns null for non-string input', () => {
    expect(parseMaintenanceMessageCookie(null)).toBeNull()
    expect(parseMaintenanceMessageCookie(undefined)).toBeNull()
    expect(parseMaintenanceMessageCookie(123)).toBeNull()
    expect(parseMaintenanceMessageCookie({})).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(parseMaintenanceMessageCookie('')).toBeNull()
  })

  it('returns null for whitespace-only input', () => {
    expect(parseMaintenanceMessageCookie('   ')).toBeNull()
  })

  it('returns null for malformed URL encoding', () => {
    expect(parseMaintenanceMessageCookie('%E0%A4%A')).toBeNull() // bad UTF-8
    expect(parseMaintenanceMessageCookie('%ZZ')).toBeNull()
  })

  it('returns null when decoded length exceeds the DB cap (defense in depth)', () => {
    const overlong = 'x'.repeat(1001)
    const encoded = encodeURIComponent(overlong)
    expect(parseMaintenanceMessageCookie(encoded)).toBeNull()
  })

  it('accepts messages at exactly the DB cap', () => {
    const atCap = 'x'.repeat(1000)
    const encoded = encodeURIComponent(atCap)
    expect(parseMaintenanceMessageCookie(encoded)).toBe(atCap)
  })
})

describe('normalizeMaintenanceMessage', () => {
  it('returns null for empty / whitespace-only input', () => {
    expect(normalizeMaintenanceMessage('')).toBeNull()
    expect(normalizeMaintenanceMessage('   ')).toBeNull()
    expect(normalizeMaintenanceMessage(null)).toBeNull()
    expect(normalizeMaintenanceMessage(undefined)).toBeNull()
    expect(normalizeMaintenanceMessage(123)).toBeNull()
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeMaintenanceMessage('  hi  ')).toBe('hi')
  })

  it('collapses runs of 3+ newlines down to 2', () => {
    expect(normalizeMaintenanceMessage('a\n\n\n\nb')).toBe('a\n\nb')
    expect(normalizeMaintenanceMessage('a\n\nb')).toBe('a\n\nb') // already 2 — unchanged
  })

  it('caps at MAINTENANCE_MESSAGE_MAX (500 chars) defensively', () => {
    const long = 'x'.repeat(800)
    const normalized = normalizeMaintenanceMessage(long)
    expect(normalized?.length).toBe(MAINTENANCE_MESSAGE_MAX)
  })

  it('returns the input unchanged when under the cap', () => {
    expect(normalizeMaintenanceMessage('Back in 5 minutes.')).toBe('Back in 5 minutes.')
  })
})

describe('formatMaintenanceMessage', () => {
  it('returns the default message for null / undefined / non-string input', () => {
    expect(formatMaintenanceMessage(null)).toBe(MAINTENANCE_DEFAULT_MESSAGE)
    expect(formatMaintenanceMessage(undefined)).toBe(MAINTENANCE_DEFAULT_MESSAGE)
    expect(formatMaintenanceMessage(123)).toBe(MAINTENANCE_DEFAULT_MESSAGE)
  })

  it('returns the default for empty / whitespace input', () => {
    expect(formatMaintenanceMessage('')).toBe(MAINTENANCE_DEFAULT_MESSAGE)
    expect(formatMaintenanceMessage('   ')).toBe(MAINTENANCE_DEFAULT_MESSAGE)
  })

  it('returns the message unchanged when under the maxLen', () => {
    expect(formatMaintenanceMessage('Back soon', 500)).toBe('Back soon')
  })

  it('truncates with an ellipsis when over maxLen', () => {
    const long = 'x'.repeat(600)
    const out = formatMaintenanceMessage(long, 500)
    expect(out.length).toBe(500)
    expect(out.endsWith('\u2026')).toBe(true)
  })

  it('trims + collapses whitespace', () => {
    expect(formatMaintenanceMessage('  hi\n\n\n\nthere  ')).toBe('hi\n\nthere')
  })

  it('respects a custom maxLen argument', () => {
    expect(formatMaintenanceMessage('Hello world', 5)).toBe('Hell\u2026')
  })
})

describe('formatMaintenanceTimestamp', () => {
  it('returns "" for null / undefined / non-string input', () => {
    expect(formatMaintenanceTimestamp(null)).toBe('')
    expect(formatMaintenanceTimestamp(undefined)).toBe('')
    expect(formatMaintenanceTimestamp(123)).toBe('')
    expect(formatMaintenanceTimestamp('')).toBe('')
  })

  it('returns "" for invalid ISO strings', () => {
    expect(formatMaintenanceTimestamp('not a date')).toBe('')
    expect(formatMaintenanceTimestamp('2026-13-99T99:99:99Z')).toBe('')
  })

  it('renders ISO strings as YYYY-MM-DD HH:MM UTC', () => {
    expect(formatMaintenanceTimestamp('2026-07-01T12:34:00Z')).toBe('2026-07-01 12:34 UTC')
  })

  it('renders dates with non-zero minutes correctly (no leading-zero drift)', () => {
    expect(formatMaintenanceTimestamp('2026-01-05T00:05:00Z')).toBe('2026-01-05 00:05 UTC')
  })

  it('renders midnight UTC', () => {
    expect(formatMaintenanceTimestamp('2026-12-31T00:00:00Z')).toBe('2026-12-31 00:00 UTC')
  })
})

describe('cookie option builders', () => {
  it('maintenanceEnabledCookieOptions: 60s TTL, HTTP-only, Lax, path=/, Secure (required by __Host-)', () => {
    const opts = maintenanceEnabledCookieOptions()
    expect(opts.maxAge).toBe(60)
    expect(opts.httpOnly).toBe(true)
    expect(opts.sameSite).toBe('lax')
    expect(opts.path).toBe('/')
    // SEC-2: unconditionally true — the __Host- name prefix requires
    // Secure regardless of environment (browsers reject the cookie
    // otherwise).
    expect(opts.secure).toBe(true)
  })

  it('maintenanceMessageCookieOptions: same shape as the enabled cookie', () => {
    const enabled = maintenanceEnabledCookieOptions()
    const message = maintenanceMessageCookieOptions()
    expect(message).toEqual(enabled)
  })
})

describe('resolveMaintenanceCookieSecure', () => {
  it('returns true when NODE_ENV=production', () => {
    expect(resolveMaintenanceCookieSecure('production')).toBe(true)
  })

  it('returns false for development / test / anything else', () => {
    expect(resolveMaintenanceCookieSecure('development')).toBe(false)
    expect(resolveMaintenanceCookieSecure('test')).toBe(false)
    expect(resolveMaintenanceCookieSecure(undefined)).toBe(false)
    expect(resolveMaintenanceCookieSecure(null)).toBe(false)
    expect(resolveMaintenanceCookieSecure('')).toBe(false)
  })
})

describe('rateLimitVerdict', () => {
  const now = 1_700_000_000_000

  it('allows the first attempt (empty history)', () => {
    expect(rateLimitVerdict(undefined, now)).toEqual({ allowed: true })
    expect(rateLimitVerdict([], now)).toEqual({ allowed: true })
  })

  it('allows up to the max in the window', () => {
    const recent = Array.from({ length: 9 }, (_, i) => now - (i + 1) * 1000)
    expect(rateLimitVerdict(recent, now)).toEqual({ allowed: true })
  })

  it('denies the 11th attempt (over the 10/window cap)', () => {
    const recent = Array.from({ length: 10 }, (_, i) => now - (i + 1) * 1000)
    const verdict = rateLimitVerdict(recent, now)
    expect(verdict.allowed).toBe(false)
    if (!verdict.allowed) {
      expect(verdict.retryAfterSeconds).toBeGreaterThan(0)
    }
  })

  it('drops attempts outside the window before counting', () => {
    const recent = [
      now - 1000,
      now - 2000,
      now - 3000,
      // 25h old — should be dropped
      now - 25 * 60 * 60 * 1000,
      now - 30 * 60 * 60 * 1000,
    ]
    expect(rateLimitVerdict(recent, now)).toEqual({ allowed: true })
  })

  it('computes retry-after based on the oldest in-window attempt', () => {
    // 10 attempts: oldest is 1000ms ago, so retry-after ≈ 1000ms → 1s
    const recent = Array.from({ length: 10 }, (_, i) => now - (i + 1) * 1000)
    const verdict = rateLimitVerdict(recent, now)
    expect(verdict.allowed).toBe(false)
    if (!verdict.allowed) {
      // oldest = now - 10000ms → expires at now - 10000 + 24h. retry = ~24h - 10s.
      // So the result is ~86390 seconds.
      expect(verdict.retryAfterSeconds).toBeGreaterThan(86_000)
    }
  })

  it('respects a custom max argument (for tests)', () => {
    const recent = [now - 1000, now - 2000]
    expect(rateLimitVerdict(recent, now, 2)).toEqual({ allowed: false, retryAfterSeconds: expect.any(Number) })
  })

  it('handles a single attempt that is itself outside the window', () => {
    const oldAttempt = [now - 25 * 60 * 60 * 1000]
    expect(rateLimitVerdict(oldAttempt, now)).toEqual({ allowed: true })
  })
})

describe('MaintenanceStateSchema (Zod schema smoke)', () => {
  it('accepts the canonical shape', () => {
    const r = MaintenanceStateSchema.safeParse({
      enabled: true,
      started_at: '2026-07-01T12:00:00Z',
      message: 'Back soon',
    })
    expect(r.success).toBe(true)
  })

  it('accepts null started_at', () => {
    const r = MaintenanceStateSchema.safeParse({
      enabled: false,
      started_at: null,
      message: 'Back soon',
    })
    expect(r.success).toBe(true)
  })

  it('accepts (does not reject) extra keys — the schema is permissive, the coercer is the boundary', () => {
    const r = MaintenanceStateSchema.safeParse({
      enabled: false,
      started_at: null,
      message: 'Back soon',
      extra: 'nope',
    })
    expect(r.success).toBe(true)
  })
})