// approveSuspendRateLimit.test.ts — pure-function tests for the
// 20/hr/admin sliding-window rate limiter on the partner approval
// actions.

import { describe, expect, it, beforeEach } from 'vitest'
import {
  rateLimitVerdict,
  _resetApproveSuspendRateLimitForTests,
  APPROVE_SUSPEND_RATE_LIMIT_MAX_PER_ADMIN,
  APPROVE_SUSPEND_RATE_LIMIT_WINDOW_MS,
} from './approveSuspendRateLimit'

const ONE_HOUR_MS = 60 * 60 * 1000

describe('approveSuspendRateLimit', () => {
  beforeEach(() => {
    _resetApproveSuspendRateLimitForTests()
  })

  it('exports the documented constants', () => {
    expect(APPROVE_SUSPEND_RATE_LIMIT_MAX_PER_ADMIN).toBe(20)
    expect(APPROVE_SUSPEND_RATE_LIMIT_WINDOW_MS).toBe(ONE_HOUR_MS)
  })

  it('allows the first attempt for a fresh admin', () => {
    const verdict = rateLimitVerdict('admin-a', 1000)
    expect(verdict.allowed).toBe(true)
    expect(verdict.retryAfterSeconds).toBe(0)
    expect(verdict.count).toBe(1)
  })

  it('allows exactly N attempts in the window, then denies', () => {
    const now = 100_000
    for (let i = 0; i < APPROVE_SUSPEND_RATE_LIMIT_MAX_PER_ADMIN; i++) {
      const v = rateLimitVerdict('admin-a', now + i * 1000)
      expect(v.allowed).toBe(true)
    }
    // 21st attempt should be denied.
    const denied = rateLimitVerdict('admin-a', now + APPROVE_SUSPEND_RATE_LIMIT_MAX_PER_ADMIN * 1000)
    expect(denied.allowed).toBe(false)
    expect(denied.count).toBe(APPROVE_SUSPEND_RATE_LIMIT_MAX_PER_ADMIN)
    expect(denied.retryAfterSeconds).toBeGreaterThan(0)
  })

  it('isolates per-admin — admin-b is unaffected when admin-a is exhausted', () => {
    const now = 100_000
    for (let i = 0; i <= APPROVE_SUSPEND_RATE_LIMIT_MAX_PER_ADMIN; i++) {
      rateLimitVerdict('admin-a', now + i * 1000)
    }
    // admin-a is now blocked; admin-b still has full quota.
    const bVerdict = rateLimitVerdict('admin-b', now)
    expect(bVerdict.allowed).toBe(true)
    expect(bVerdict.count).toBe(1)
  })

  it('oldest attempts fall out of the sliding window', () => {
    const base = 1_000_000
    // Fill the window at base.
    for (let i = 0; i < APPROVE_SUSPEND_RATE_LIMIT_MAX_PER_ADMIN; i++) {
      rateLimitVerdict('admin-a', base + i * 1000)
    }
    // One window later, all old attempts have fallen out.
    const later = base + APPROVE_SUSPEND_RATE_LIMIT_WINDOW_MS + 60_000
    const verdict = rateLimitVerdict('admin-a', later)
    expect(verdict.allowed).toBe(true)
    expect(verdict.count).toBe(1)
  })

  it('counts attempts that span the window boundary correctly', () => {
    const base = 1_000_000
    // 15 attempts at base.
    for (let i = 0; i < 15; i++) {
      rateLimitVerdict('admin-a', base + i * 1000)
    }
    // 15 minutes later (halfway through the window), the first 15 are still in.
    const mid = base + 15 * 60 * 1000
    for (let i = 0; i < 5; i++) {
      const v = rateLimitVerdict('admin-a', mid + i * 1000)
      expect(v.allowed).toBe(true)
    }
    // 21st attempt — total of 20 still in the window — should deny.
    const denied = rateLimitVerdict('admin-a', mid + 5 * 1000)
    expect(denied.allowed).toBe(false)
  })

  it('retryAfterSeconds equals the remaining window for the oldest attempt', () => {
    const base = 2_000_000
    for (let i = 0; i < APPROVE_SUSPEND_RATE_LIMIT_MAX_PER_ADMIN; i++) {
      rateLimitVerdict('admin-a', base + i * 1000)
    }
    const denied = rateLimitVerdict(
      'admin-a',
      base + APPROVE_SUSPEND_RATE_LIMIT_MAX_PER_ADMIN * 1000,
    )
    expect(denied.allowed).toBe(false)
    // The oldest attempt was at `base`, so the window expires at
    // `base + ONE_HOUR_MS`. The 21st attempt is at
    // `base + 20_000`, so retryAfter is ~ONE_HOUR_MS - 20_000 seconds.
    const expected = Math.ceil((ONE_HOUR_MS - 20_000) / 1000)
    expect(denied.retryAfterSeconds).toBe(expected)
  })

  it('denied attempts do NOT extend the window', () => {
    const base = 3_000_000
    for (let i = 0; i < APPROVE_SUSPEND_RATE_LIMIT_MAX_PER_ADMIN; i++) {
      rateLimitVerdict('admin-a', base + i * 1000)
    }
    // A denied attempt at base + 21s should not consume a slot.
    const denied = rateLimitVerdict('admin-a', base + 21_000)
    expect(denied.allowed).toBe(false)
    expect(denied.count).toBe(APPROVE_SUSPEND_RATE_LIMIT_MAX_PER_ADMIN)
    // After the window passes (with enough headroom to clear all
    // 20 slots, not just the oldest one), admin-a can attempt again
    // with a fresh count.
    const after = base + ONE_HOUR_MS + 30_000
    const verdict = rateLimitVerdict('admin-a', after)
    expect(verdict.allowed).toBe(true)
    expect(verdict.count).toBe(1)
  })

  it('_resetApproveSuspendRateLimitForTests clears all counters', () => {
    rateLimitVerdict('admin-a', 0)
    rateLimitVerdict('admin-b', 0)
    _resetApproveSuspendRateLimitForTests()
    const a = rateLimitVerdict('admin-a', 1000)
    const b = rateLimitVerdict('admin-b', 1000)
    expect(a.count).toBe(1)
    expect(b.count).toBe(1)
  })

  it('handles concurrent admins independently across many slots', () => {
    const now = 5_000_000
    // Spread 5 admins × 4 attempts each = 20 attempts in the window.
    // Every admin stays under the 20/admin cap.
    for (let a = 0; a < 5; a++) {
      for (let i = 0; i < 4; i++) {
        const v = rateLimitVerdict(`admin-${a}`, now + (a * 4 + i) * 1000)
        expect(v.allowed).toBe(true)
      }
    }
    // Now spike admin-3 to 21 — denied at 21.
    for (let i = 0; i < 17; i++) {
      rateLimitVerdict('admin-3', now + 100_000 + i * 1000)
    }
    const denied = rateLimitVerdict('admin-3', now + 100_000 + 17 * 1000)
    expect(denied.allowed).toBe(false)
  })
})