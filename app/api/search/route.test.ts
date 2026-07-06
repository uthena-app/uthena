// route.test.ts — unit tests for GET /api/search's SEC-3 interim rate
// limit (60/min/hashed-IP). Mocks `searchPublishedProducts` so the test
// never touches Supabase; resets the shared in-process limiter between
// tests so runs don't leak state across files.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { _resetSlidingWindowRateLimitForTests } from '@foundations/files/rate-limit-shared'

vi.mock('@features/search/queries', () => ({
  searchPublishedProducts: vi.fn(async () => []),
}))

import { GET } from './route'

function makeRequest(query: string, ip: string): NextRequest {
  return new NextRequest(`https://uthena.com/api/search?${query}`, {
    headers: { 'x-forwarded-for': ip },
  })
}

beforeEach(() => {
  _resetSlidingWindowRateLimitForTests()
})

afterEach(() => {
  _resetSlidingWindowRateLimitForTests()
  vi.clearAllMocks()
})

describe('GET /api/search — SEC-3 interim rate limit', () => {
  it('allows the first 60 requests from a single IP within a minute', async () => {
    const ip = '203.0.113.10'
    for (let i = 0; i < 60; i++) {
      const res = await GET(makeRequest('q=course', ip))
      expect(res.status).toBe(200)
    }
  })

  it('returns 429 with Retry-After on the 61st request from the same IP', async () => {
    const ip = '203.0.113.11'
    for (let i = 0; i < 60; i++) {
      await GET(makeRequest('q=course', ip))
    }
    const res = await GET(makeRequest('q=course', ip))
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBeTruthy()
    const body = await res.json()
    expect(body.error).toBe('rate_limited')
  })

  it('does not rate-limit a different IP once the first is saturated', async () => {
    const ipA = '203.0.113.12'
    const ipB = '203.0.113.13'
    for (let i = 0; i < 60; i++) {
      await GET(makeRequest('q=course', ipA))
    }
    const deniedA = await GET(makeRequest('q=course', ipA))
    expect(deniedA.status).toBe(429)

    const okB = await GET(makeRequest('q=course', ipB))
    expect(okB.status).toBe(200)
  })

  it('still 400s on invalid query even when under the rate limit', async () => {
    const res = await GET(makeRequest('q=', '203.0.113.14'))
    expect(res.status).toBe(400)
  })
})
