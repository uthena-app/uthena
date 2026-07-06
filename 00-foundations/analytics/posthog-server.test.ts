// posthog-server.test.ts — unit tests for the server-side PostHog
// capture helper. Covers:
//   - isPosthogServerConfigured: env-gated (POSTHOG_PROJECT_API_KEY
//     preferred; falls back to NEXT_PUBLIC_POSTHOG_KEY for dev parity)
//   - hashIdentifierForPosthog: salt-applied sha256, 32 hex chars
//   - trackPosthogServer: env-gated no-op when unconfigured, schema
//     validation rejects bad props, successful capture posts to the
//     capture endpoint with the expected body shape, non-2xx returns
//     a typed failure (never throws), fetch errors are caught
//   - Defaults: DEFAULT_POSTHOG_HOST + EU capture path
//
// Strategy: vi.mock the global `fetch` so no real network calls are
// made. The env helper (`getEnv`) is reset per test via the existing
// `_resetEnvForTests` escape hatch.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { _resetEnvForTests } from '../env'

// ----- Mock the global fetch so no real network calls --------------
const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
  return new Response('{"status":"ok"}', { status: 200 })
})
vi.stubGlobal('fetch', fetchMock)

// ----- Mock pino logger so log calls don't print -----------------
const loggerMock = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}
vi.mock('../log/pino', () => ({
  loggerFor: () => loggerMock,
}))

// Import AFTER the global fetch + pino mocks are set up so the
// helper's module-scope references are bound to the mocks.
const { isPosthogServerConfigured, hashIdentifierForPosthog, trackPosthogServer } =
  await import('./posthog-server')

const BASE_ENV = {
  NEXT_PUBLIC_POSTHOG_KEY: 'phc_test_abc123',
  POSTHOG_PROJECT_API_KEY: '',
  AUDIT_HASH_SALT: '',
  NEXT_PUBLIC_POSTHOG_HOST: 'https://eu.i.posthog.com',
}

function setEnv(overrides: Partial<typeof BASE_ENV> = {}) {
  for (const [k, v] of Object.entries(BASE_ENV)) {
    const target = overrides as Record<string, string | undefined>
    process.env[k] = k in target && target[k] !== undefined ? target[k]! : v
  }
  _resetEnvForTests()
}

function clearPosthogEnv() {
  process.env.NEXT_PUBLIC_POSTHOG_KEY = ''
  process.env.POSTHOG_PROJECT_API_KEY = ''
  _resetEnvForTests()
}

beforeEach(() => {
  setEnv()
  fetchMock.mockClear()
  loggerMock.info.mockClear()
  loggerMock.warn.mockClear()
  loggerMock.debug.mockClear()
})

afterEach(() => {
  clearPosthogEnv()
})

// ============================================================================
// isPosthogServerConfigured
// ============================================================================

describe('isPosthogServerConfigured', () => {
  it('returns true when POSTHOG_PROJECT_API_KEY is set', () => {
    setEnv({ POSTHOG_PROJECT_API_KEY: 'phc_server_xyz' })
    expect(isPosthogServerConfigured()).toBe(true)
  })

  it('returns true when only NEXT_PUBLIC_POSTHOG_KEY is set (dev parity)', () => {
    setEnv({ POSTHOG_PROJECT_API_KEY: '' })
    expect(isPosthogServerConfigured()).toBe(true)
  })

  it('returns false when both keys are empty', () => {
    clearPosthogEnv()
    expect(isPosthogServerConfigured()).toBe(false)
  })
})

// ============================================================================
// hashIdentifierForPosthog
// ============================================================================

describe('hashIdentifierForPosthog', () => {
  it('returns a 32-char hex string', () => {
    const h = hashIdentifierForPosthog('user-uuid-1')
    expect(h).toMatch(/^[a-f0-9]{32}$/)
  })

  it('is stable for the same input (deterministic)', () => {
    expect(hashIdentifierForPosthog('user-uuid-1')).toBe(hashIdentifierForPosthog('user-uuid-1'))
  })

  it('changes when the salt changes', () => {
    setEnv({ AUDIT_HASH_SALT: 'salt-a' })
    const a = hashIdentifierForPosthog('user-uuid-1')
    setEnv({ AUDIT_HASH_SALT: 'salt-b' })
    const b = hashIdentifierForPosthog('user-uuid-1')
    expect(a).not.toBe(b)
  })

  it('uses a dev fallback when no salt is configured (per-process pid)', () => {
    setEnv({ AUDIT_HASH_SALT: '' })
    const h = hashIdentifierForPosthog('user-uuid-1')
    expect(h).toMatch(/^[a-f0-9]{32}$/)
  })
})

// ============================================================================
// trackPosthogServer — env-gated no-op
// ============================================================================

describe('trackPosthogServer — unconfigured', () => {
  it('returns ok=false and does not call fetch when unconfigured', async () => {
    clearPosthogEnv()
    const res = await trackPosthogServer(
      'cart_abandoned',
      {
        user_id_hash: 'a'.repeat(32),
        line_count: 1,
        subtotal_cents: 0,
        days_idle_max: 26,
      },
      'distinct-id',
    )
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBe('posthog_server_unconfigured')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// ============================================================================
// trackPosthogServer — schema validation
// ============================================================================

describe('trackPosthogServer — schema validation', () => {
  it('rejects cart_abandoned props with line_count = 0', async () => {
    setEnv({ POSTHOG_PROJECT_API_KEY: 'phc_server_xyz' })
    const res = await trackPosthogServer(
      'cart_abandoned',
      {
        user_id_hash: 'a'.repeat(32),
        line_count: 0, // positive-required
        subtotal_cents: 0,
        days_idle_max: 26,
      },
      'distinct-id',
    )
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBe('invalid_props')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(loggerMock.warn).toHaveBeenCalled()
  })

  it('rejects when user_id_hash is missing', async () => {
    setEnv({ POSTHOG_PROJECT_API_KEY: 'phc_server_xyz' })
    const res = await trackPosthogServer(
      'cart_abandoned',
      {
        // user_id_hash missing
        line_count: 1,
        subtotal_cents: 0,
        days_idle_max: 26,
      } as unknown as Parameters<typeof trackPosthogServer>[1],
      'distinct-id',
    )
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBe('invalid_props')
  })
})

// ============================================================================
// trackPosthogServer — successful capture
// ============================================================================

describe('trackPosthogServer — successful capture', () => {
  it('POSTs to the EU capture endpoint with the expected body shape', async () => {
    setEnv({ POSTHOG_PROJECT_API_KEY: 'phc_server_xyz' })
    fetchMock.mockResolvedValueOnce(new Response('{"status":"ok"}', { status: 200 }))

    const res = await trackPosthogServer(
      'cart_abandoned',
      {
        user_id_hash: 'a'.repeat(32),
        line_count: 2,
        subtotal_cents: 9700,
        days_idle_max: 27,
      },
      'distinct-id-hash',
    )
    expect(res.ok).toBe(true)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://eu.i.posthog.com/capture/')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json')

    const body = JSON.parse(init.body as string)
    expect(body.api_key).toBe('phc_server_xyz')
    expect(body.event).toBe('cart_abandoned')
    expect(body.distinct_id).toBe('distinct-id-hash')
    expect(body.properties.user_id_hash).toBe('a'.repeat(32))
    expect(body.properties.line_count).toBe(2)
    expect(body.properties.subtotal_cents).toBe(9700)
    expect(body.properties.days_idle_max).toBe(27)
    // Server-side capture marker is appended.
    expect(body.properties.$source).toBe('posthog-server')
  })

  it('falls back to NEXT_PUBLIC_POSTHOG_KEY when POSTHOG_PROJECT_API_KEY is empty', async () => {
    setEnv({ POSTHOG_PROJECT_API_KEY: '', NEXT_PUBLIC_POSTHOG_KEY: 'phc_public_xyz' })
    fetchMock.mockResolvedValueOnce(new Response('', { status: 200 }))

    await trackPosthogServer(
      'cart_abandoned',
      {
        user_id_hash: 'a'.repeat(32),
        line_count: 1,
        subtotal_cents: 0,
        days_idle_max: 26,
      },
      'd',
    )
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string)
    expect(body.api_key).toBe('phc_public_xyz')
  })

  it('respects a custom NEXT_PUBLIC_POSTHOG_HOST override', async () => {
    setEnv({
      POSTHOG_PROJECT_API_KEY: 'phc_server_xyz',
      NEXT_PUBLIC_POSTHOG_HOST: 'https://us.i.posthog.com',
    })
    fetchMock.mockResolvedValueOnce(new Response('', { status: 200 }))

    await trackPosthogServer(
      'cart_abandoned',
      {
        user_id_hash: 'a'.repeat(32),
        line_count: 1,
        subtotal_cents: 0,
        days_idle_max: 26,
      },
      'd',
    )
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://us.i.posthog.com/capture/')
  })

  it('strips a trailing slash on the host', async () => {
    setEnv({
      POSTHOG_PROJECT_API_KEY: 'phc_server_xyz',
      NEXT_PUBLIC_POSTHOG_HOST: 'https://eu.i.posthog.com/',
    })
    fetchMock.mockResolvedValueOnce(new Response('', { status: 200 }))

    await trackPosthogServer(
      'cart_abandoned',
      {
        user_id_hash: 'a'.repeat(32),
        line_count: 1,
        subtotal_cents: 0,
        days_idle_max: 26,
      },
      'd',
    )
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://eu.i.posthog.com/capture/')
  })
})

// ============================================================================
// trackPosthogServer — failure paths
// ============================================================================

describe('trackPosthogServer — failure paths', () => {
  it('returns a typed failure on non-2xx (never throws)', async () => {
    setEnv({ POSTHOG_PROJECT_API_KEY: 'phc_server_xyz' })
    fetchMock.mockResolvedValueOnce(new Response('rate limited', { status: 429 }))

    const res = await trackPosthogServer(
      'cart_abandoned',
      {
        user_id_hash: 'a'.repeat(32),
        line_count: 1,
        subtotal_cents: 0,
        days_idle_max: 26,
      },
      'd',
    )
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error).toBe('capture_failed')
      expect(res.status).toBe(429)
    }
    expect(loggerMock.warn).toHaveBeenCalled()
  })

  it('returns a typed failure when fetch itself throws', async () => {
    setEnv({ POSTHOG_PROJECT_API_KEY: 'phc_server_xyz' })
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'))

    const res = await trackPosthogServer(
      'cart_abandoned',
      {
        user_id_hash: 'a'.repeat(32),
        line_count: 1,
        subtotal_cents: 0,
        days_idle_max: 26,
      },
      'd',
    )
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBe('fetch_failed')
  })
})
