// Unit tests for the pure concurrent-stream decision helper in
// `concurrent-streams.ts`. No DB, no env, no clock — the helper is
// pure. Run with `pnpm test concurrent-streams` (vitest).

import { describe, expect, it } from 'vitest'
import {
  MAX_CONCURRENT_STREAMS,
  _resetConcurrentStreamLimitForTests,
  evaluateConcurrentStreamLimit,
} from './concurrent-streams'

// ===========================================================================
// Boundary
// ===========================================================================

describe('evaluateConcurrentStreamLimit — boundary (limit=3)', () => {
  it('allows when active count is 0 (first stream)', () => {
    const r = evaluateConcurrentStreamLimit(0)
    expect(r.allowed).toBe(true)
    expect(r.current).toBe(1)
    expect(r.limit).toBe(3)
    expect(r.retryAfterActiveCount).toBe(0)
  })

  it('allows when active count is below the limit', () => {
    expect(evaluateConcurrentStreamLimit(1).allowed).toBe(true)
    expect(evaluateConcurrentStreamLimit(2).allowed).toBe(true)
  })

  it('denies when active count equals the limit (3rd would be 4th)', () => {
    const r = evaluateConcurrentStreamLimit(3)
    expect(r.allowed).toBe(false)
    expect(r.current).toBe(3)
    expect(r.limit).toBe(3)
    expect(r.retryAfterActiveCount).toBe(3)
  })

  it('denies when active count exceeds the limit (defensive)', () => {
    // Defensive — the DB query caps the count at the limit, but a
    // drifted value (race + a row that hasn't expired yet) shouldn't
    // cause a crash or a false-positive allow.
    const r = evaluateConcurrentStreamLimit(7)
    expect(r.allowed).toBe(false)
    expect(r.current).toBe(7)
    expect(r.limit).toBe(3)
  })
})

// ===========================================================================
// Default limit matches the constant
// ===========================================================================

describe('evaluateConcurrentStreamLimit — default limit', () => {
  it('uses MAX_CONCURRENT_STREAMS as the default', () => {
    const r = evaluateConcurrentStreamLimit(0)
    expect(r.limit).toBe(MAX_CONCURRENT_STREAMS)
  })

  it('MAX_CONCURRENT_STREAMS is 3 (documented in concurrent-streams.ts)', () => {
    expect(MAX_CONCURRENT_STREAMS).toBe(3)
  })

  it('a caller can override the limit (test seam)', () => {
    const allowed = evaluateConcurrentStreamLimit(0, 1)
    expect(allowed.allowed).toBe(true)
    expect(allowed.limit).toBe(1)
    const denied = evaluateConcurrentStreamLimit(1, 1)
    expect(denied.allowed).toBe(false)
    expect(denied.limit).toBe(1)
  })
})

// ===========================================================================
// Defensive inputs
// ===========================================================================

describe('evaluateConcurrentStreamLimit — defensive inputs', () => {
  it('treats negative count as 0', () => {
    const r = evaluateConcurrentStreamLimit(-1)
    expect(r.allowed).toBe(true)
    expect(r.current).toBe(1)
  })

  it('treats NaN as 0', () => {
    const r = evaluateConcurrentStreamLimit(Number.NaN)
    expect(r.allowed).toBe(true)
    expect(r.current).toBe(1)
  })

  it('treats Infinity as 0 (permissive on bad input)', () => {
    // The helper is a courtesy limit, not a security boundary.
    // Bad input from a future admin tool or test shouldn't block a
    // legitimate user. The DB query never returns bad input; this
    // branch is purely defensive for hypothetical edge cases.
    const r = evaluateConcurrentStreamLimit(Number.POSITIVE_INFINITY)
    expect(r.allowed).toBe(true)
    expect(r.current).toBe(1)
  })

  it('floors fractional counts before comparing', () => {
    const r = evaluateConcurrentStreamLimit(2.7)
    expect(r.current).toBe(3) // floor(2.7) = 2, +1 for the new mint
    expect(r.allowed).toBe(true) // 3 <= 3 (the limit) → still allowed
  })

  it('a fractional count that floors to the limit denies', () => {
    // 2.999 floors to 2 → safe=2, next=3 → allowed.
    // 3.0 floors to 3 → safe=3, next=4 → denied.
    const r = evaluateConcurrentStreamLimit(3.0)
    expect(r.current).toBe(3)
    expect(r.allowed).toBe(false)
  })
})

// ===========================================================================
// reset helper
// ===========================================================================

describe('test-only helpers', () => {
  it('_resetConcurrentStreamLimitForTests is a no-op (pure module)', () => {
    // The helper exists for symmetry with rate-limit.ts; verify it
    // doesn't throw and doesn't mutate anything.
    expect(() => _resetConcurrentStreamLimitForTests()).not.toThrow()
    // State is unaffected — calling again still works.
    const r = evaluateConcurrentStreamLimit(0)
    expect(r.allowed).toBe(true)
  })
})