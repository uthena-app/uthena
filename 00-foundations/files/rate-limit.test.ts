// Unit tests for the in-process signed-URL rate limiter in
// `rate-limit.ts`. Pure function over an in-process Map. Uses fake
// timers to control the 1h window.
//
// Run: `pnpm test rate-limit` (vitest).

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  _resetSignedUrlRateLimitForTests,
  _signedUrlRateLimitSize,
  checkAndRecordSignedUrlMint,
} from './rate-limit'
import { HOUR_MS, SIGNED_URL_LIMIT_PER_HOUR } from './signed-url'

const USER_A = '11111111-1111-1111-1111-111111111111'
const USER_B = '22222222-2222-2222-2222-222222222222'

// Pin a reference "now" so the tests are reproducible. 2026-06-25 noon UTC.
const NOW = Date.parse('2026-06-25T12:00:00.000Z')

beforeEach(() => {
  _resetSignedUrlRateLimitForTests()
})

afterEach(() => {
  _resetSignedUrlRateLimitForTests()
})

// ===========================================================================
// Happy path
// ===========================================================================

describe('checkAndRecordSignedUrlMint — happy path', () => {
  it('allows the first call for a user', () => {
    const r = checkAndRecordSignedUrlMint(USER_A, NOW)
    expect(r.allowed).toBe(true)
    expect(r.count).toBe(1)
    expect(r.limit).toBe(SIGNED_URL_LIMIT_PER_HOUR)
    expect(r.retryAfterSeconds).toBe(0)
  })
  it('increments the count on every allowed call', () => {
    for (let i = 1; i <= 5; i++) {
      const r = checkAndRecordSignedUrlMint(USER_A, NOW + i * 1000)
      expect(r.allowed).toBe(true)
      expect(r.count).toBe(i)
    }
  })
  it('tracks users independently', () => {
    for (let i = 0; i < 5; i++) {
      checkAndRecordSignedUrlMint(USER_A, NOW + i * 1000)
    }
    const rB = checkAndRecordSignedUrlMint(USER_B, NOW + 100)
    expect(rB.allowed).toBe(true)
    expect(rB.count).toBe(1)
  })
})

// ===========================================================================
// Ceiling + sliding window
// ===========================================================================

describe('checkAndRecordSignedUrlMint — ceiling', () => {
  it('denies the (limit+1)-th call inside the same 1h window', () => {
    // Saturate the bucket with 60 hits, all at the same moment so the
    // window math is unambiguous.
    for (let i = 0; i < SIGNED_URL_LIMIT_PER_HOUR; i++) {
      const r = checkAndRecordSignedUrlMint(USER_A, NOW)
      expect(r.allowed).toBe(true)
    }
    // The 61st call should be denied.
    const denied = checkAndRecordSignedUrlMint(USER_A, NOW)
    expect(denied.allowed).toBe(false)
    expect(denied.count).toBe(SIGNED_URL_LIMIT_PER_HOUR)
    expect(denied.limit).toBe(SIGNED_URL_LIMIT_PER_HOUR)
  })

  it('reports retryAfterSeconds as the time until the oldest hit ages out', () => {
    // One hit at NOW, then 59 hits in the next 59 seconds. The oldest
    // hit is at NOW. We check 100ms after the first hit — retry-after
    // should be ≈ 1h - 100ms ≈ 3600s (ceiling).
    checkAndRecordSignedUrlMint(USER_A, NOW)
    for (let i = 1; i < SIGNED_URL_LIMIT_PER_HOUR; i++) {
      checkAndRecordSignedUrlMint(USER_A, NOW + i * 1000)
    }
    // 61st call at NOW+60s+100ms (just past the most-recent hit at
    // NOW+59s). Denied.
    const denied = checkAndRecordSignedUrlMint(USER_A, NOW + 60_000 + 100)
    expect(denied.allowed).toBe(false)
    // The oldest hit is at NOW, so it ages out at NOW + HOUR_MS.
    // We're at NOW+60s+100ms, so retryAfterMs = HOUR_MS - (60s+100ms)
    // = 3539.9s, ceil = 3540s.
    expect(denied.retryAfterSeconds).toBe(3540)
  })

  it('does NOT count denied calls (denial is read-only on the bucket)', () => {
    // Saturate the bucket.
    for (let i = 0; i < SIGNED_URL_LIMIT_PER_HOUR; i++) {
      checkAndRecordSignedUrlMint(USER_A, NOW + i * 1000)
    }
    // 3 denials. None of them should be recorded.
    for (let i = 0; i < 3; i++) {
      const d = checkAndRecordSignedUrlMint(USER_A, NOW + 60_000 + i * 1000)
      expect(d.allowed).toBe(false)
    }
    // After the window slides past the first hit (at NOW), only the
    // 59 remaining hits are in the window. The new call should be
    // allowed and bring the count to 60.
    const recovered = checkAndRecordSignedUrlMint(USER_A, NOW + HOUR_MS + 1000)
    expect(recovered.allowed).toBe(true)
    // The first hit (at NOW) has slid out; 58 of the original 60 are
    // still in the window (the hit at NOW+1s is also out — exactly
    // HOUR_MS old, excluded by the strict-less comparison). The new
    // call is the 59th.
    expect(recovered.count).toBe(59)
  })

  it('denial surfaces a retryAfterSeconds >= 1 even at the boundary', () => {
    // Saturate the bucket.
    for (let i = 0; i < SIGNED_URL_LIMIT_PER_HOUR; i++) {
      checkAndRecordSignedUrlMint(USER_A, NOW)
    }
    // Check immediately. The oldest hit was just now — retry-after
    // should be 3600s (full window).
    const denied = checkAndRecordSignedUrlMint(USER_A, NOW + 1)
    expect(denied.allowed).toBe(false)
    expect(denied.retryAfterSeconds).toBe(HOUR_MS / 1000)
  })
})

// ===========================================================================
// Sliding window
// ===========================================================================

describe('checkAndRecordSignedUrlMint — sliding window', () => {
  it('allows a new call as soon as the oldest hit slides out', () => {
    // Saturate the bucket.
    for (let i = 0; i < SIGNED_URL_LIMIT_PER_HOUR; i++) {
      checkAndRecordSignedUrlMint(USER_A, NOW)
    }
    expect(checkAndRecordSignedUrlMint(USER_A, NOW + 1).allowed).toBe(false)
    // 1h + 1s later. The original hit is now HOUR_MS + 1s old (out of
    // window). The new call is allowed and is the 1st in a fresh
    // window.
    const after = checkAndRecordSignedUrlMint(USER_A, NOW + HOUR_MS + 1000)
    expect(after.allowed).toBe(true)
    expect(after.count).toBe(1)
  })

  it('fully recovers when the entire window has slid past', () => {
    for (let i = 0; i < SIGNED_URL_LIMIT_PER_HOUR; i++) {
      checkAndRecordSignedUrlMint(USER_A, NOW + i * 1000)
    }
    // 2h later — every hit is way out of window.
    const r = checkAndRecordSignedUrlMint(USER_A, NOW + 2 * HOUR_MS)
    expect(r.allowed).toBe(true)
    expect(r.count).toBe(1)
  })

  it('handles a burst at the boundary correctly', () => {
    // 60 hits in the first 60s
    for (let i = 0; i < SIGNED_URL_LIMIT_PER_HOUR; i++) {
      checkAndRecordSignedUrlMint(USER_A, NOW + i * 1000)
    }
    // 61st at +60s is denied
    expect(checkAndRecordSignedUrlMint(USER_A, NOW + 60_000).allowed).toBe(false)
    // 62nd at +1h+1s is allowed (oldest hit has slid out)
    expect(checkAndRecordSignedUrlMint(USER_A, NOW + HOUR_MS + 1000).allowed).toBe(true)
  })
})

// ===========================================================================
// Per-user isolation
// ===========================================================================

describe('checkAndRecordSignedUrlMint — per-user isolation', () => {
  it('User A at the ceiling does not block User B', () => {
    for (let i = 0; i < SIGNED_URL_LIMIT_PER_HOUR; i++) {
      checkAndRecordSignedUrlMint(USER_A, NOW + i * 100)
    }
    // User A is saturated.
    expect(checkAndRecordSignedUrlMint(USER_A, NOW + 100).allowed).toBe(false)
    // User B is fresh.
    const rB = checkAndRecordSignedUrlMint(USER_B, NOW + 100)
    expect(rB.allowed).toBe(true)
    expect(rB.count).toBe(1)
  })
})

// ===========================================================================
// Reset helpers
// ===========================================================================

describe('test-only helpers', () => {
  it('_resetSignedUrlRateLimitForTests clears all buckets', () => {
    checkAndRecordSignedUrlMint(USER_A, NOW)
    checkAndRecordSignedUrlMint(USER_B, NOW)
    expect(_signedUrlRateLimitSize()).toBe(2)
    _resetSignedUrlRateLimitForTests()
    expect(_signedUrlRateLimitSize()).toBe(0)
  })
  it('_signedUrlRateLimitSize reports the number of tracked users', () => {
    expect(_signedUrlRateLimitSize()).toBe(0)
    checkAndRecordSignedUrlMint(USER_A, NOW)
    expect(_signedUrlRateLimitSize()).toBe(1)
    checkAndRecordSignedUrlMint(USER_A, NOW + 1) // same user
    expect(_signedUrlRateLimitSize()).toBe(1)
    checkAndRecordSignedUrlMint(USER_B, NOW + 2)
    expect(_signedUrlRateLimitSize()).toBe(2)
  })
})

// ===========================================================================
// Real-time sanity (uses Date.now, not the override)
// ===========================================================================

describe('checkAndRecordSignedUrlMint — real time fallback', () => {
  it('uses Date.now() when no nowMs is passed', () => {
    const r = checkAndRecordSignedUrlMint(USER_A)
    expect(r.allowed).toBe(true)
    expect(r.count).toBe(1)
  })
  it('does not throw without nowMs', () => {
    expect(() => checkAndRecordSignedUrlMint(USER_A)).not.toThrow()
  })
})
