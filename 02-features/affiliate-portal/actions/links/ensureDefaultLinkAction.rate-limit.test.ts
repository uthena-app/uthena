// ensureDefaultLinkAction.rate-limit.test.ts — pure rate-limit tests.

import { describe, it, expect, beforeEach } from 'vitest'
import {
  rateLimitVerdict,
  _resetEnsureDefaultLinkRateLimitForTests,
} from './ensureDefaultLinkAction.rate-limit'

beforeEach(() => {
  _resetEnsureDefaultLinkRateLimitForTests()
})

describe('rateLimitVerdict — sliding-window math', () => {
  it('allows the first hit', () => {
    const v = rateLimitVerdict({
      userId: 'user_1',
      windowMs: 60_000,
      max: 5,
      now: 1_000,
    })
    expect(v.allowed).toBe(true)
  })

  it('allows up to `max` hits inside the window', () => {
    for (let i = 0; i < 5; i++) {
      const v = rateLimitVerdict({
        userId: 'user_2',
        windowMs: 60_000,
        max: 5,
        now: 1_000 + i * 100,
      })
      expect(v.allowed).toBe(true)
    }
  })

  it('denies the 6th hit inside a 60s window', () => {
    for (let i = 0; i < 5; i++) {
      rateLimitVerdict({
        userId: 'user_3',
        windowMs: 60_000,
        max: 5,
        now: 1_000 + i * 100,
      })
    }
    const v = rateLimitVerdict({
      userId: 'user_3',
      windowMs: 60_000,
      max: 5,
      now: 1_000 + 500,
    })
    expect(v.allowed).toBe(false)
    expect(v.retryAfterMs).toBeGreaterThan(0)
  })

  it('permits new hits once prior hits fall outside the window', () => {
    for (let i = 0; i < 5; i++) {
      rateLimitVerdict({
        userId: 'user_4',
        windowMs: 60_000,
        max: 5,
        now: 1_000 + i * 100,
      })
    }
    // Jump 61s forward — all prior hits are now outside the window.
    const v = rateLimitVerdict({
      userId: 'user_4',
      windowMs: 60_000,
      max: 5,
      now: 62_000,
    })
    expect(v.allowed).toBe(true)
  })

  it('isolates rate limits per user', () => {
    for (let i = 0; i < 5; i++) {
      rateLimitVerdict({
        userId: 'user_5a',
        windowMs: 60_000,
        max: 5,
        now: 1_000 + i * 100,
      })
    }
    const v = rateLimitVerdict({
      userId: 'user_5b',
      windowMs: 60_000,
      max: 5,
      now: 1_000 + 500,
    })
    expect(v.allowed).toBe(true)
  })

  it('returns retryAfterMs = 0 when allowed', () => {
    const v = rateLimitVerdict({
      userId: 'user_6',
      windowMs: 60_000,
      max: 5,
      now: 1_000,
    })
    expect(v.retryAfterMs).toBe(0)
  })

  it('returns a positive retryAfterMs when denied', () => {
    for (let i = 0; i < 5; i++) {
      rateLimitVerdict({
        userId: 'user_7',
        windowMs: 60_000,
        max: 5,
        now: 1_000 + i * 100,
      })
    }
    const v = rateLimitVerdict({
      userId: 'user_7',
      windowMs: 60_000,
      max: 5,
      now: 1_000 + 500,
    })
    expect(v.allowed).toBe(false)
    expect(v.retryAfterMs).toBeGreaterThan(0)
    expect(v.retryAfterMs).toBeLessThanOrEqual(60_000)
  })
})
