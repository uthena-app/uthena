// page-rate-limit.test.ts — unit tests for the per-user page rate
// limiter.
//
// P13.1 — covers the sliding-window logic + the test reset hook.
// Mirrors `02-features/partner-onboarding/lib/page-rate-limit.test.ts`
// (P12.3) — the math for "all entries age out" needs `nowMs >
// WINDOW_MS + lastEntryMs`, not just `nowMs > WINDOW_MS` (because
// entries are spaced within the window, so the last entry is
// `lastEntryMs` past `t0`).

import { describe, expect, it } from 'vitest'

const {
  PAGE_VIEW_RATE_LIMIT_MAX_PER_USER,
  PAGE_VIEW_RATE_LIMIT_WINDOW_MS,
  pageRateLimitVerdict,
  _resetPageRateLimitForTests,
} = await import('./page-rate-limit')

describe('pageRateLimitVerdict', () => {
  it('allows the first call for a fresh user', () => {
    _resetPageRateLimitForTests()
    const result = pageRateLimitVerdict('user-1', 1_000)
    expect(result).toEqual({ allowed: true, retryAfterSeconds: 0, count: 1 })
  })

  it('increments the count up to the limit', () => {
    _resetPageRateLimitForTests()
    for (let i = 1; i <= PAGE_VIEW_RATE_LIMIT_MAX_PER_USER; i++) {
      const r = pageRateLimitVerdict('user-1', 1_000 + i)
      expect(r.allowed).toBe(true)
      expect(r.count).toBe(i)
    }
  })

  it('denies when count exceeds the per-user cap', () => {
    _resetPageRateLimitForTests()
    for (let i = 0; i < PAGE_VIEW_RATE_LIMIT_MAX_PER_USER; i++) {
      pageRateLimitVerdict('user-1', 1_000 + i)
    }
    const denied = pageRateLimitVerdict(
      'user-1',
      1_000 + PAGE_VIEW_RATE_LIMIT_MAX_PER_USER,
    )
    expect(denied.allowed).toBe(false)
    expect(denied.count).toBe(PAGE_VIEW_RATE_LIMIT_MAX_PER_USER)
    expect(denied.retryAfterSeconds).toBeGreaterThan(0)
    expect(denied.retryAfterSeconds).toBeLessThanOrEqual(
      Math.ceil(PAGE_VIEW_RATE_LIMIT_WINDOW_MS / 1000),
    )
  })

  it('isolates counters per user', () => {
    _resetPageRateLimitForTests()
    for (let i = 0; i < PAGE_VIEW_RATE_LIMIT_MAX_PER_USER; i++) {
      pageRateLimitVerdict('user-1', 1_000 + i)
    }
    const other = pageRateLimitVerdict(
      'user-2',
      1_000 + PAGE_VIEW_RATE_LIMIT_MAX_PER_USER,
    )
    expect(other.allowed).toBe(true)
    expect(other.count).toBe(1)
  })

  it('slides the window — old entries expire', () => {
    _resetPageRateLimitForTests()
    // 60 entries spaced 100ms apart (saturation)
    for (let i = 0; i < PAGE_VIEW_RATE_LIMIT_MAX_PER_USER; i++) {
      pageRateLimitVerdict('user-1', i * 100)
    }
    // At t = WINDOW + lastEntryMs + 1, every entry has aged out by
    // at least 1ms.
    const lastEntryMs = (PAGE_VIEW_RATE_LIMIT_MAX_PER_USER - 1) * 100
    const later = pageRateLimitVerdict(
      'user-1',
      PAGE_VIEW_RATE_LIMIT_WINDOW_MS + lastEntryMs + 1,
    )
    expect(later.allowed).toBe(true)
    expect(later.count).toBe(1)
  })

  it('expires entries one-by-one as the window slides', () => {
    _resetPageRateLimitForTests()
    // 30 entries at t=0..2900ms
    for (let i = 0; i < 30; i++) {
      pageRateLimitVerdict('user-1', i * 100)
    }
    const lastEntryMs = 29 * 100 // 2900ms
    const later = pageRateLimitVerdict(
      'user-1',
      PAGE_VIEW_RATE_LIMIT_WINDOW_MS + lastEntryMs + 1,
    )
    expect(later.allowed).toBe(true)
    expect(later.count).toBe(1)
  })

  it('returns retryAfterSeconds >= 1 when denied', () => {
    _resetPageRateLimitForTests()
    for (let i = 0; i < PAGE_VIEW_RATE_LIMIT_MAX_PER_USER; i++) {
      pageRateLimitVerdict('user-1', 1_000 + i)
    }
    const denied = pageRateLimitVerdict(
      'user-1',
      1_000 + PAGE_VIEW_RATE_LIMIT_MAX_PER_USER,
    )
    expect(denied.retryAfterSeconds).toBeGreaterThanOrEqual(1)
  })

  it('does not record a denied attempt (does not push to recent)', () => {
    _resetPageRateLimitForTests()
    for (let i = 0; i < PAGE_VIEW_RATE_LIMIT_MAX_PER_USER; i++) {
      pageRateLimitVerdict('user-1', 1_000 + i)
    }
    const before = pageRateLimitVerdict(
      'user-1',
      1_000 + PAGE_VIEW_RATE_LIMIT_MAX_PER_USER,
    )
    expect(before.allowed).toBe(false)
    const after = pageRateLimitVerdict(
      'user-1',
      1_000 + PAGE_VIEW_RATE_LIMIT_MAX_PER_USER + 50,
    )
    expect(after.count).toBe(before.count)
  })

  it('constants are within the spec contract', () => {
    expect(PAGE_VIEW_RATE_LIMIT_MAX_PER_USER).toBe(60)
    expect(PAGE_VIEW_RATE_LIMIT_WINDOW_MS).toBe(60_000)
  })
})

describe('_resetPageRateLimitForTests', () => {
  it('clears the bucket between users', () => {
    pageRateLimitVerdict('user-1', 1_000)
    _resetPageRateLimitForTests()
    const after = pageRateLimitVerdict('user-1', 2_000)
    expect(after.count).toBe(1)
  })
})