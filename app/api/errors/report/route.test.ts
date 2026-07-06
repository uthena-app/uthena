// route.test.ts — unit tests for POST /api/errors/report's SEC-3
// interim rate limit (30/min/hashed-IP). Mocks `captureError` so the
// test never touches the observability seam's env gates; resets the
// shared in-process limiter between tests.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { _resetSlidingWindowRateLimitForTests } from '@foundations/files/rate-limit-shared'

vi.mock('@foundations/observability/sentry', () => ({
  captureError: vi.fn(() => ({ ok: true, mode: 'log', id: 'ERR-TEST' })),
}))

import { POST } from './route'

function makeRequest(ip: string, body: unknown = validBody()): NextRequest {
  return new NextRequest('https://uthena.com/api/errors/report', {
    method: 'POST',
    headers: {
      'x-forwarded-for': ip,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

function validBody() {
  return {
    surface: 'app.error',
    errId: 'ERR-ABCDEFGHIJ',
    errorName: 'TypeError',
  }
}

beforeEach(() => {
  _resetSlidingWindowRateLimitForTests()
})

afterEach(() => {
  _resetSlidingWindowRateLimitForTests()
  vi.clearAllMocks()
})

describe('POST /api/errors/report — SEC-3 interim rate limit', () => {
  it('allows the first 30 requests from a single IP within a minute', async () => {
    const ip = '198.51.100.10'
    for (let i = 0; i < 30; i++) {
      const res = await POST(makeRequest(ip))
      expect(res.status).toBe(204)
    }
  })

  it('still returns 204 (never a visible error) on the 31st request — silently dropped', async () => {
    const ip = '198.51.100.11'
    for (let i = 0; i < 30; i++) {
      await POST(makeRequest(ip))
    }
    const res = await POST(makeRequest(ip))
    // Per the route's contract, rate-limited requests still 204 — the
    // client boundary must never see a non-204 as "the capture broke".
    expect(res.status).toBe(204)
  })

  it('does not rate-limit a different IP once the first is saturated', async () => {
    const ipA = '198.51.100.12'
    const ipB = '198.51.100.13'
    for (let i = 0; i < 30; i++) {
      await POST(makeRequest(ipA))
    }
    const okB = await POST(makeRequest(ipB))
    expect(okB.status).toBe(204)
  })

  it('the 31st request from a saturated IP does NOT invoke captureError (denied before parse)', async () => {
    const { captureError } = await import('@foundations/observability/sentry')
    const ip = '198.51.100.14'
    for (let i = 0; i < 30; i++) {
      await POST(makeRequest(ip))
    }
    vi.mocked(captureError).mockClear()
    await POST(makeRequest(ip))
    expect(captureError).not.toHaveBeenCalled()
  })
})
