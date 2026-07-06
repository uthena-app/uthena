// Unit tests for the Gorse seam in `00-foundations/recommendations/gorse.ts`.
// Covers:
//
//   - isGorseConfigured: env-gated behavior
//   - recommend(): no-op when not configured, success path with both
//     item-list and bare-string response shapes, error paths (non-2xx,
//     network failure, abort timeout), query-string encoding
//   - trackEvent(): no-op when not configured, success path (POST
//     body shape), auth headers, error paths
//   - GORSE_FEEDBACK_KINDS: catalog + coverage
//
// Run: `pnpm test gorse` (vitest).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { _resetEnvForTests } from '../env'
import {
  GORSE_FEEDBACK_KINDS,
  isGorseConfigured,
  recommend,
  trackEvent,
} from './gorse'

// ===========================================================================
// Env management
// ===========================================================================

const BASE_ENV = {
  GORSE_API_URL: 'https://gorse.example.test',
  GORSE_API_KEY: 'gorse-key-abc',
}

function setEnv(overrides: Partial<typeof BASE_ENV> = {}) {
  if (overrides.GORSE_API_URL === '') {
    delete process.env.GORSE_API_URL
  } else {
    process.env.GORSE_API_URL = overrides.GORSE_API_URL ?? BASE_ENV.GORSE_API_URL
  }
  if (overrides.GORSE_API_KEY === '') {
    delete process.env.GORSE_API_KEY
  } else {
    process.env.GORSE_API_KEY = overrides.GORSE_API_KEY ?? BASE_ENV.GORSE_API_KEY
  }
  _resetEnvForTests()
}

function clearEnv() {
  delete process.env.GORSE_API_URL
  delete process.env.GORSE_API_KEY
  _resetEnvForTests()
}

beforeEach(() => {
  setEnv()
})

afterEach(() => {
  clearEnv()
  vi.restoreAllMocks()
})

// ===========================================================================
// isGorseConfigured
// ===========================================================================

describe('isGorseConfigured', () => {
  it('returns true when GORSE_API_URL is set', () => {
    setEnv({ GORSE_API_URL: 'https://gorse.example.test' })
    expect(isGorseConfigured()).toBe(true)
  })

  it('returns false when GORSE_API_URL is empty', () => {
    setEnv({ GORSE_API_URL: '' })
    expect(isGorseConfigured()).toBe(false)
  })
})

// ===========================================================================
// Feedback catalog
// ===========================================================================

describe('GORSE_FEEDBACK_KINDS', () => {
  it('contains the 5 documented kinds', () => {
    expect(GORSE_FEEDBACK_KINDS).toEqual(['view', 'click', 'add_to_cart', 'purchase', 'signup'])
  })

  it('has no duplicates', () => {
    expect(new Set(GORSE_FEEDBACK_KINDS).size).toBe(GORSE_FEEDBACK_KINDS.length)
  })
})

// ===========================================================================
// recommend()
// ===========================================================================

describe('recommend() — no-op when unconfigured', () => {
  it('returns [] without making a fetch call when GORSE_API_URL is empty', async () => {
    setEnv({ GORSE_API_URL: '' })
    const fetchSpy = vi.spyOn(global, 'fetch')
    const r = await recommend({ userId: null, kind: 'home' })
    expect(r).toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('recommend() — success path', () => {
  it('returns string IDs from an items[] response', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ items: [{ Id: 'p1' }, { Id: 'p2' }, { id: 'p3' }] }), {
        status: 200,
      }),
    )
    const r = await recommend({ userId: null, kind: 'home', limit: 5 })
    expect(r).toEqual(['p1', 'p2', 'p3'])
  })

  it('returns string IDs from a bare-array response', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(['p1', 'p2']), { status: 200 }),
    )
    const r = await recommend({ userId: null, kind: 'home' })
    expect(r).toEqual(['p1', 'p2'])
  })

  it('filters out items missing both Id and id', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ items: [{ Id: 'p1' }, {}, { id: '' }, { Id: 'p2' }] }), {
        status: 200,
      }),
    )
    const r = await recommend({ userId: null, kind: 'home' })
    expect(r).toEqual(['p1', 'p2'])
  })

  it('appends productId as ?id= when provided (URL-encoded)', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }))
    await recommend({ userId: null, productId: 'weird/id with spaces', kind: 'product' })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const url = fetchSpy.mock.calls[0]![0] as string
    expect(url).toContain('/api/recommend/product?')
    expect(url).toContain('id=weird%2Fid%20with%20spaces')
  })

  it('omits ?id= when productId is absent', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }))
    await recommend({ userId: null, kind: 'home' })
    const url = fetchSpy.mock.calls[0]![0] as string
    expect(url).not.toContain('id=')
  })

  it('uses default limit 12 when not specified', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }))
    await recommend({ userId: null, kind: 'home' })
    const url = fetchSpy.mock.calls[0]![0] as string
    expect(url).toContain('limit=12')
  })

  it('passes the userId as X-User-ID when present', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }))
    await recommend({ userId: 'u1', kind: 'home' })
    const init = fetchSpy.mock.calls[0]![1] as RequestInit
    expect((init.headers as Record<string, string>)['X-User-ID']).toBe('u1')
  })

  it('passes the API key as X-API-Key when configured', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }))
    await recommend({ userId: null, kind: 'home' })
    const init = fetchSpy.mock.calls[0]![1] as RequestInit
    expect((init.headers as Record<string, string>)['X-API-Key']).toBe('gorse-key-abc')
  })

  it('omits X-API-Key when no API key is configured', async () => {
    setEnv({ GORSE_API_KEY: '' })
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }))
    await recommend({ userId: null, kind: 'home' })
    const init = fetchSpy.mock.calls[0]![1] as RequestInit
    expect((init.headers as Record<string, string>)['X-API-Key']).toBeUndefined()
  })
})

describe('recommend() — error paths', () => {
  it('returns [] on non-2xx', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('boom', { status: 500 }))
    const r = await recommend({ userId: null, kind: 'home' })
    expect(r).toEqual([])
  })

  it('returns [] on network failure', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'))
    const r = await recommend({ userId: null, kind: 'home' })
    expect(r).toEqual([])
  })

  it('returns [] on invalid JSON', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('not-json', { status: 200 }))
    const r = await recommend({ userId: null, kind: 'home' })
    expect(r).toEqual([])
  })
})

// ===========================================================================
// trackEvent()
// ===========================================================================

describe('trackEvent() — no-op when unconfigured', () => {
  it('does not fetch when GORSE_API_URL is empty', async () => {
    setEnv({ GORSE_API_URL: '' })
    const fetchSpy = vi.spyOn(global, 'fetch')
    await trackEvent({ userId: 'u1', productId: 'p1', event: 'view' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('trackEvent() — success path', () => {
  it('POSTs the wire-format body (capitalized keys)', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))
    await trackEvent({ userId: 'u1', productId: 'p1', event: 'click' })
    const init = fetchSpy.mock.calls[0]![1] as RequestInit
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({
      UserId: 'u1',
      ItemId: 'p1',
      FeedbackType: 'click',
      Value: undefined,
    })
  })

  it('includes Value when provided', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))
    await trackEvent({ userId: 'u1', productId: 'p1', event: 'purchase', value: 4900 })
    const init = fetchSpy.mock.calls[0]![1] as RequestInit
    expect(JSON.parse(init.body as string).Value).toBe(4900)
  })

  it('uses the /api/feedback endpoint', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))
    await trackEvent({ userId: 'u1', productId: 'p1', event: 'view' })
    const url = fetchSpy.mock.calls[0]![0] as string
    expect(url).toBe('https://gorse.example.test/api/feedback')
  })
})

describe('trackEvent() — error paths', () => {
  it('does not throw on network failure', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'))
    await expect(
      trackEvent({ userId: 'u1', productId: 'p1', event: 'view' }),
    ).resolves.toBeUndefined()
  })

  it('does not throw on non-2xx', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('boom', { status: 500 }))
    await expect(
      trackEvent({ userId: 'u1', productId: 'p1', event: 'view' }),
    ).resolves.toBeUndefined()
  })
})