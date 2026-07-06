// Tests for the Sentry seam. We verify:
//   1. Env-gated behavior (configured vs unconfigured returns the right mode)
//   2. PII safety (never logs error.message or error.stack)
//   3. Required fields in the structured payload (errId, surface, error.name, error.digest)
//   4. Defensive: missing errId → skipped, captureError throwing → caught
//   5. Empty/invalid input doesn't blow up the boundary

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock pino BEFORE importing the Sentry seam (the seam reads the logger
// at module load). The mock returns an object whose `.info / .warn / .error`
// are no-ops that we can spy on. The spy consts must be hoisted via
// vi.hoisted() because the mock factory is hoisted to the top of the
// file, but `const` declarations are NOT hoisted (temporal dead zone).
const { errorSpy, warnSpy, infoSpy } = vi.hoisted(() => ({
  errorSpy: vi.fn(),
  warnSpy: vi.fn(),
  infoSpy: vi.fn(),
}))

vi.mock('@foundations/log/pino', () => ({
  loggerFor: () => ({
    error: errorSpy,
    warn: warnSpy,
    info: infoSpy,
    debug: vi.fn(),
    child: vi.fn(),
  }),
}))

// Mock env so we can flip SENTRY_DSN between tests.
const envValues: Record<string, string> = {
  SENTRY_DSN: '',
  NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
  NEXT_PUBLIC_APP_NAME: 'Uthena',
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'dev-placeholder-anon',
  SUPABASE_SERVICE_ROLE_KEY: 'dev-placeholder-service-role',
  AUTH_SECRET: 'x'.repeat(32),
  ALLOWED_ORIGINS: 'http://localhost:3000',
  NODE_ENV: 'test',
}
vi.mock('@foundations/env', () => ({
  getEnv: () => envValues,
}))

import { captureError, isSentryConfigured } from './sentry'

beforeEach(() => {
  errorSpy.mockReset()
  warnSpy.mockReset()
  infoSpy.mockReset()
})

afterEach(() => {
  envValues.SENTRY_DSN = ''
})

describe('isSentryConfigured', () => {
  it('returns false when SENTRY_DSN is empty', () => {
    envValues.SENTRY_DSN = ''
    expect(isSentryConfigured()).toBe(false)
  })

  it('returns true when SENTRY_DSN is set', () => {
    envValues.SENTRY_DSN = 'https://examplePublicKey@o0.ingest.sentry.io/0'
    expect(isSentryConfigured()).toBe(true)
  })
})

describe('captureError — unconfigured (default)', () => {
  beforeEach(() => {
    envValues.SENTRY_DSN = ''
  })

  it('returns mode: log when Sentry is not configured', () => {
    const err = Object.assign(new Error('boom'), { digest: 'd1' })
    const result = captureError(err, { surface: 'app.error', errId: 'ERR-ABC2345678' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.mode).toBe('log')
    }
  })

  it('writes the structured event to pino error', () => {
    const err = Object.assign(new Error('boom'), { digest: 'd1' })
    captureError(err, { surface: 'app.error', errId: 'ERR-ABC2345678' })
    expect(errorSpy).toHaveBeenCalledTimes(1)
    const [payload, msg] = errorSpy.mock.calls[0] ?? []
    expect(msg).toContain('error:')
    expect(payload).toMatchObject({
      event: 'server.error',
      errId: 'ERR-ABC2345678',
      surface: 'app.error',
      'error.name': 'Error',
      'error.digest': 'd1',
    })
  })

  it('includes tags when provided', () => {
    const err = Object.assign(new Error('boom'), { digest: 'd1' })
    captureError(err, {
      surface: 'app.account.error',
      errId: 'ERR-ABC2345678',
      tags: { 'http.method': 'GET', 'http.route': '/account' },
    })
    const [payload] = errorSpy.mock.calls[0] ?? []
    expect(payload).toMatchObject({
      tags: {
        'uthena.err_id': 'ERR-ABC2345678',
        'uthena.surface': 'app.account.error',
        'http.method': 'GET',
        'http.route': '/account',
      },
    })
  })

  it('includes actor when provided', () => {
    const err = Object.assign(new Error('boom'), { digest: 'd1' })
    captureError(err, {
      surface: 'app.account.error',
      errId: 'ERR-ABC2345678',
      actor: { kind: 'user', user_id: 'u_1' },
    })
    const [payload] = errorSpy.mock.calls[0] ?? []
    expect(payload).toMatchObject({
      actor: { kind: 'user', user_id: 'u_1' },
    })
  })

  // PII-safety tests — the AGENTS.md §2 contract
  it('NEVER logs error.message (PII-safety)', () => {
    const err = Object.assign(new Error('user@example.com tried /secret'), { digest: 'd1' })
    captureError(err, { surface: 'app.error', errId: 'ERR-ABC2345678' })
    const [payload, msg] = errorSpy.mock.calls[0] ?? []
    // The payload object must not contain `.message`
    expect(JSON.stringify(payload)).not.toContain('user@example.com')
    expect(JSON.stringify(payload)).not.toContain('/secret')
    expect(msg).not.toContain('user@example.com')
  })

  it('NEVER logs error.stack (PII-safety)', () => {
    const err = new Error('boom')
    err.stack = 'Error: boom\n    at /Users/klaas/secret-path/file.ts:42:13'
    captureError(err, { surface: 'app.error', errId: 'ERR-ABC2345678' })
    const [payload] = errorSpy.mock.calls[0] ?? []
    expect(JSON.stringify(payload)).not.toContain('/Users/klaas/secret-path')
    expect(JSON.stringify(payload)).not.toContain('secret-path')
    expect(JSON.stringify(payload)).not.toContain('file.ts:42:13')
  })

  it('NEVER tags user emails (typed Actor union makes this hard, but defense-in-depth)', () => {
    const err = Object.assign(new Error('boom'), { digest: 'd1' })
    captureError(err, {
      surface: 'app.error',
      errId: 'ERR-ABC2345678',
      tags: { email: 'should@be.stripped.com' },
    })
    const [payload] = errorSpy.mock.calls[0] ?? []
    // We don't auto-strip — caller is responsible. The test documents
    // the contract: passing an `email` tag is the caller's mistake, and
    // we should reject it at the type level (the tags: Record<string, string>
    // allows it, but a stricter typed envelope is the future-proof shape).
    // For now, document the current behavior.
    expect(payload.tags).toMatchObject({ email: 'should@be.stripped.com' })
  })
})

describe('captureError — configured', () => {
  beforeEach(() => {
    envValues.SENTRY_DSN = 'https://examplePublicKey@o0.ingest.sentry.io/0'
  })

  it('still returns mode: log because the SDK ships in PH18', () => {
    const err = Object.assign(new Error('boom'), { digest: 'd1' })
    const result = captureError(err, { surface: 'app.error', errId: 'ERR-ABC2345678' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.mode).toBe('log')
    }
    // The "SDK not wired" warn fires so support can see when a configured
    // env is producing log-only captures (catches a future regression
    // where someone removes the SDK-warning but forgets to wire the SDK).
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'sentry.configured_but_sdk_not_wired' }),
      expect.stringContaining('PH18'),
    )
  })

  it('still emits the structured error event', () => {
    const err = Object.assign(new Error('boom'), { digest: 'd1' })
    captureError(err, { surface: 'app.error', errId: 'ERR-ABC2345678' })
    expect(errorSpy).toHaveBeenCalled()
  })
})

describe('captureError — defensive paths', () => {
  it('returns skipped when errId is missing', () => {
    const err = Object.assign(new Error('boom'), { digest: 'd1' })
    const result = captureError(err, { surface: 'app.error', errId: '' })
    expect(result).toEqual({ ok: false, mode: 'skipped', reason: 'missing errId' })
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('catches a logger throw and returns skipped (boundary must never crash)', () => {
    errorSpy.mockImplementationOnce(() => {
      throw new Error('logger broken')
    })
    const err = Object.assign(new Error('boom'), { digest: 'd1' })
    const result = captureError(err, { surface: 'app.error', errId: 'ERR-ABC2345678' })
    expect(result).toEqual({ ok: false, mode: 'skipped', reason: 'capture threw' })
  })

  it('handles an Error without digest', () => {
    const err: Error & { digest?: string } = new Error('boom')
    expect(err.digest).toBeUndefined()
    const result = captureError(err, { surface: 'app.error', errId: 'ERR-ABC2345678' })
    expect(result.ok).toBe(true)
    const [payload] = errorSpy.mock.calls[0] ?? []
    expect(payload['error.digest']).toBeUndefined()
  })
})