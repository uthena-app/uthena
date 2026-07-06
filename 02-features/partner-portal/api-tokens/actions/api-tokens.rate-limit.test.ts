// Unit tests for `api-tokens.rate-limit.ts` — P12.19.
//
// Coverage:
//   - Per-bucket isolation: hitting the create cap does NOT affect
//     the list cap (and vice versa) — same pattern as
//     `saveUploadDraft.rate-limit.test.ts`.
//   - Sliding window: timestamps older than the window are evicted.
//   - Retry-after math: returns whole seconds, floor at 1.
//   - Per-user isolation: user A's deny does not affect user B.
//   - The reset helper clears both buckets.

import { describe, expect, it, beforeEach } from 'vitest'
import {
  _resetApiTokensRateLimitForTests,
  createRateLimitVerdict,
  listRateLimitVerdict,
} from './api-tokens.rate-limit'
import {
  API_TOKEN_CREATE_RATE_LIMIT_MAX_PER_PARTNER,
  API_TOKEN_CREATE_RATE_LIMIT_WINDOW_MS,
  API_TOKEN_LIST_RATE_LIMIT_MAX_PER_PARTNER,
  API_TOKEN_LIST_RATE_LIMIT_WINDOW_MS,
} from '../constants'

const HOUR_MS = 60 * 60 * 1000

describe('createRateLimitVerdict', () => {
  beforeEach(() => _resetApiTokensRateLimitForTests())

  it('allows up to 5 creates per hour', () => {
    const userId = 'u-create-1'
    const base = 1_700_000_000_000
    for (let i = 0; i < API_TOKEN_CREATE_RATE_LIMIT_MAX_PER_PARTNER; i++) {
      const v = createRateLimitVerdict(userId, base + i)
      expect(v.allowed).toBe(true)
      expect(v.count).toBe(i + 1)
    }
  })

  it('denies the 6th attempt and returns a positive retryAfter', () => {
    const userId = 'u-create-2'
    const base = 1_700_000_000_000
    for (let i = 0; i < API_TOKEN_CREATE_RATE_LIMIT_MAX_PER_PARTNER; i++) {
      createRateLimitVerdict(userId, base + i)
    }
    const denied = createRateLimitVerdict(userId, base + API_TOKEN_CREATE_RATE_LIMIT_MAX_PER_PARTNER)
    expect(denied.allowed).toBe(false)
    expect(denied.retryAfterSeconds).toBeGreaterThan(0)
    expect(denied.retryAfterSeconds).toBeLessThanOrEqual(API_TOKEN_CREATE_RATE_LIMIT_WINDOW_MS / 1000)
  })

  it('resets after the window elapses', () => {
    const userId = 'u-create-3'
    const base = 1_700_000_000_000
    for (let i = 0; i < API_TOKEN_CREATE_RATE_LIMIT_MAX_PER_PARTNER; i++) {
      createRateLimitVerdict(userId, base + i)
    }
    expect(createRateLimitVerdict(userId, base + API_TOKEN_CREATE_RATE_LIMIT_MAX_PER_PARTNER).allowed).toBe(
      false,
    )
    // Jump well past the window — every prior timestamp must expire.
    // `nowMs - t < windowMs` is the filter; with the most-recent
    // timestamp at `base + 4`, we need `nowMs > base + 4 + windowMs`.
    const after = base + API_TOKEN_CREATE_RATE_LIMIT_MAX_PER_PARTNER + API_TOKEN_CREATE_RATE_LIMIT_WINDOW_MS + 1
    const fresh = createRateLimitVerdict(userId, after)
    expect(fresh.allowed).toBe(true)
    expect(fresh.count).toBe(1)
  })

  it('isolates by user', () => {
    const userA = 'u-create-A'
    const userB = 'u-create-B'
    const base = 1_700_000_000_000
    // Saturate userA.
    for (let i = 0; i < API_TOKEN_CREATE_RATE_LIMIT_MAX_PER_PARTNER; i++) {
      createRateLimitVerdict(userA, base + i)
    }
    expect(createRateLimitVerdict(userA, base).allowed).toBe(false)
    // userB is untouched.
    const fresh = createRateLimitVerdict(userB, base)
    expect(fresh.allowed).toBe(true)
    expect(fresh.count).toBe(1)
  })

  it('does not consume a slot when denied (denials do not extend the window)', () => {
    const userId = 'u-create-4'
    const base = 1_700_000_000_000
    for (let i = 0; i < API_TOKEN_CREATE_RATE_LIMIT_MAX_PER_PARTNER; i++) {
      createRateLimitVerdict(userId, base + i)
    }
    const denied1 = createRateLimitVerdict(userId, base + 100)
    expect(denied1.allowed).toBe(false)
    const denied2 = createRateLimitVerdict(userId, base + 200)
    expect(denied2.allowed).toBe(false)
    expect(denied2.count).toBe(denied1.count)
  })
})

describe('listRateLimitVerdict', () => {
  beforeEach(() => _resetApiTokensRateLimitForTests())

  it('allows up to 100 list loads per hour', () => {
    const userId = 'u-list-1'
    const base = 1_700_000_000_000
    for (let i = 0; i < API_TOKEN_LIST_RATE_LIMIT_MAX_PER_PARTNER; i++) {
      const v = listRateLimitVerdict(userId, base + i)
      expect(v.allowed).toBe(true)
      expect(v.count).toBe(i + 1)
    }
  })

  it('denies the 101st attempt', () => {
    const userId = 'u-list-2'
    const base = 1_700_000_000_000
    for (let i = 0; i < API_TOKEN_LIST_RATE_LIMIT_MAX_PER_PARTNER; i++) {
      listRateLimitVerdict(userId, base + i)
    }
    const denied = listRateLimitVerdict(userId, base + API_TOKEN_LIST_RATE_LIMIT_MAX_PER_PARTNER)
    expect(denied.allowed).toBe(false)
    expect(denied.retryAfterSeconds).toBeGreaterThan(0)
  })
})

describe('create / list bucket isolation', () => {
  beforeEach(() => _resetApiTokensRateLimitForTests())

  it('hitting the create cap does not affect the list cap for the same user', () => {
    const userId = 'u-bucket-iso'
    const base = 1_700_000_000_000
    for (let i = 0; i < API_TOKEN_CREATE_RATE_LIMIT_MAX_PER_PARTNER; i++) {
      createRateLimitVerdict(userId, base + i)
    }
    // create is saturated.
    expect(createRateLimitVerdict(userId, base).allowed).toBe(false)
    // list is untouched for the same user.
    expect(listRateLimitVerdict(userId, base).allowed).toBe(true)
    // list is also independently rate-limited.
    for (let i = 0; i < API_TOKEN_LIST_RATE_LIMIT_MAX_PER_PARTNER; i++) {
      listRateLimitVerdict(userId, base + i + 1)
    }
    expect(listRateLimitVerdict(userId, base + 1).allowed).toBe(false)
    // create is still saturated (the list cap didn't lift it).
    expect(createRateLimitVerdict(userId, base).allowed).toBe(false)
  })
})

describe('_resetApiTokensRateLimitForTests', () => {
  it('clears both buckets for the test suite', () => {
    const userId = 'u-reset'
    const base = 1_700_000_000_000
    for (let i = 0; i < API_TOKEN_CREATE_RATE_LIMIT_MAX_PER_PARTNER; i++) {
      createRateLimitVerdict(userId, base + i)
    }
    expect(createRateLimitVerdict(userId, base).allowed).toBe(false)
    _resetApiTokensRateLimitForTests()
    expect(createRateLimitVerdict(userId, base).allowed).toBe(true)
  })
})

describe('HOUR_MS boundary sanity', () => {
  it('creates window is 1h exactly', () => {
    expect(API_TOKEN_CREATE_RATE_LIMIT_WINDOW_MS).toBe(HOUR_MS)
  })
  it('list window is 1h exactly', () => {
    expect(API_TOKEN_LIST_RATE_LIMIT_WINDOW_MS).toBe(HOUR_MS)
  })
})