// Unit tests for the shared sliding-window rate limiter in
// `rate-limit-shared.ts`. Pure function over an in-process Map. Mirrors
// `rate-limit.test.ts`'s style but exercises the generalized
// key/limit/window signature used by the SEC-3 interim guards on
// /api/errors/report and /api/search.
//
// Run: `pnpm test rate-limit-shared` (vitest).

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  _resetSlidingWindowRateLimitForTests,
  _slidingWindowRateLimitSize,
  checkAndRecordSlidingWindow,
} from './rate-limit-shared'

const KEY_A = 'errors_report:hash-aaaa'
const KEY_B = 'search:hash-bbbb'
const MINUTE_MS = 60_000

// Pin a reference "now" so the tests are reproducible.
const NOW = Date.parse('2026-07-03T12:00:00.000Z')

beforeEach(() => {
  _resetSlidingWindowRateLimitForTests()
})

afterEach(() => {
  _resetSlidingWindowRateLimitForTests()
})

describe('checkAndRecordSlidingWindow — happy path', () => {
  it('allows the first call for a key', () => {
    const r = checkAndRecordSlidingWindow(KEY_A, 30, MINUTE_MS, NOW)
    expect(r.allowed).toBe(true)
    expect(r.count).toBe(1)
    expect(r.limit).toBe(30)
    expect(r.retryAfterSeconds).toBe(0)
  })

  it('increments the count on every allowed call', () => {
    for (let i = 1; i <= 5; i++) {
      const r = checkAndRecordSlidingWindow(KEY_A, 30, MINUTE_MS, NOW + i * 1000)
      expect(r.allowed).toBe(true)
      expect(r.count).toBe(i)
    }
  })

  it('tracks keys independently', () => {
    for (let i = 0; i < 5; i++) {
      checkAndRecordSlidingWindow(KEY_A, 30, MINUTE_MS, NOW + i * 1000)
    }
    const rB = checkAndRecordSlidingWindow(KEY_B, 60, MINUTE_MS, NOW + 100)
    expect(rB.allowed).toBe(true)
    expect(rB.count).toBe(1)
    expect(rB.limit).toBe(60)
  })
})

describe('checkAndRecordSlidingWindow — ceiling', () => {
  it('denies the (limit+1)-th call inside the same window (30/min, errors/report shape)', () => {
    for (let i = 0; i < 30; i++) {
      const r = checkAndRecordSlidingWindow(KEY_A, 30, MINUTE_MS, NOW)
      expect(r.allowed).toBe(true)
    }
    const denied = checkAndRecordSlidingWindow(KEY_A, 30, MINUTE_MS, NOW)
    expect(denied.allowed).toBe(false)
    expect(denied.count).toBe(30)
    expect(denied.limit).toBe(30)
  })

  it('denies the (limit+1)-th call inside the same window (60/min, search shape)', () => {
    for (let i = 0; i < 60; i++) {
      const r = checkAndRecordSlidingWindow(KEY_B, 60, MINUTE_MS, NOW)
      expect(r.allowed).toBe(true)
    }
    const denied = checkAndRecordSlidingWindow(KEY_B, 60, MINUTE_MS, NOW)
    expect(denied.allowed).toBe(false)
    expect(denied.count).toBe(60)
  })

  it('does NOT count denied calls', () => {
    for (let i = 0; i < 30; i++) {
      checkAndRecordSlidingWindow(KEY_A, 30, MINUTE_MS, NOW + i * 100)
    }
    for (let i = 0; i < 3; i++) {
      const d = checkAndRecordSlidingWindow(KEY_A, 30, MINUTE_MS, NOW + 3000 + i * 10)
      expect(d.allowed).toBe(false)
    }
    const recovered = checkAndRecordSlidingWindow(KEY_A, 30, MINUTE_MS, NOW + MINUTE_MS + 1000)
    expect(recovered.allowed).toBe(true)
  })
})

describe('checkAndRecordSlidingWindow — sliding window', () => {
  it('allows a new call once the oldest hit slides out of the window', () => {
    for (let i = 0; i < 30; i++) {
      checkAndRecordSlidingWindow(KEY_A, 30, MINUTE_MS, NOW)
    }
    expect(checkAndRecordSlidingWindow(KEY_A, 30, MINUTE_MS, NOW + 1).allowed).toBe(false)
    const after = checkAndRecordSlidingWindow(KEY_A, 30, MINUTE_MS, NOW + MINUTE_MS + 1000)
    expect(after.allowed).toBe(true)
    expect(after.count).toBe(1)
  })
})

describe('checkAndRecordSlidingWindow — per-key isolation', () => {
  it('key A at the ceiling does not block key B', () => {
    for (let i = 0; i < 30; i++) {
      checkAndRecordSlidingWindow(KEY_A, 30, MINUTE_MS, NOW + i * 10)
    }
    expect(checkAndRecordSlidingWindow(KEY_A, 30, MINUTE_MS, NOW + 10).allowed).toBe(false)
    const rB = checkAndRecordSlidingWindow(KEY_B, 60, MINUTE_MS, NOW + 10)
    expect(rB.allowed).toBe(true)
    expect(rB.count).toBe(1)
  })
})

describe('test-only helpers', () => {
  it('_resetSlidingWindowRateLimitForTests clears all buckets', () => {
    checkAndRecordSlidingWindow(KEY_A, 30, MINUTE_MS, NOW)
    checkAndRecordSlidingWindow(KEY_B, 60, MINUTE_MS, NOW)
    expect(_slidingWindowRateLimitSize()).toBe(2)
    _resetSlidingWindowRateLimitForTests()
    expect(_slidingWindowRateLimitSize()).toBe(0)
  })

  it('_slidingWindowRateLimitSize reports the number of tracked keys', () => {
    expect(_slidingWindowRateLimitSize()).toBe(0)
    checkAndRecordSlidingWindow(KEY_A, 30, MINUTE_MS, NOW)
    expect(_slidingWindowRateLimitSize()).toBe(1)
    checkAndRecordSlidingWindow(KEY_A, 30, MINUTE_MS, NOW + 1) // same key
    expect(_slidingWindowRateLimitSize()).toBe(1)
    checkAndRecordSlidingWindow(KEY_B, 60, MINUTE_MS, NOW + 2)
    expect(_slidingWindowRateLimitSize()).toBe(2)
  })
})

describe('checkAndRecordSlidingWindow — real time fallback', () => {
  it('uses Date.now() when no nowMs is passed', () => {
    const r = checkAndRecordSlidingWindow(KEY_A, 30, MINUTE_MS)
    expect(r.allowed).toBe(true)
    expect(r.count).toBe(1)
  })
  it('does not throw without nowMs', () => {
    expect(() => checkAndRecordSlidingWindow(KEY_A, 30, MINUTE_MS)).not.toThrow()
  })
})
