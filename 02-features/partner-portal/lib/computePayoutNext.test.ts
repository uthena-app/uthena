// 02-features/partner-portal/lib/computePayoutNext.test.ts —
// unit tests for the payout-preview formatter (P12.18 sub-slice).
//
// Pure-function tests, no fixtures, no I/O. Runs in milliseconds.

import { describe, expect, it } from 'vitest'
import { computePayoutNext } from './computePayoutNext'

const zeroSummary = { available_cents: 0, locked_cents: 0, next_release_at: null }

describe('computePayoutNext — minimum_payout_cleared', () => {
  it('true when available_cents >= default $50 threshold', () => {
    const r = computePayoutNext(
      { available_cents: 5000, locked_cents: 0, next_release_at: null },
      { now: new Date('2026-07-15T12:00:00Z') },
    )
    expect(r.minimum_payout_cleared).toBe(true)
  })

  it('true when available_cents comfortably above $50', () => {
    const r = computePayoutNext(
      { available_cents: 7500, locked_cents: 1200, next_release_at: null },
      { now: new Date('2026-07-15T12:00:00Z') },
    )
    expect(r.minimum_payout_cleared).toBe(true)
  })

  it('false when available_cents is $1 short', () => {
    const r = computePayoutNext(
      { available_cents: 4999, locked_cents: 0, next_release_at: null },
      { now: new Date('2026-07-15T12:00:00Z') },
    )
    expect(r.minimum_payout_cleared).toBe(false)
  })

  it('false when available_cents is exactly $0', () => {
    const r = computePayoutNext(zeroSummary, { now: new Date('2026-07-15T12:00:00Z') })
    expect(r.minimum_payout_cleared).toBe(false)
  })

  it('honors a custom threshold_cents override (used by tests)', () => {
    // Some partner programs have a $100 threshold; the helper
    // accepts an override so the spec-of-tomorrow doesn't need
    // a fork. Default is the canonical MIN_PAYOUT_REQUEST_CENTS.
    const r = computePayoutNext(
      { available_cents: 7500, locked_cents: 0, next_release_at: null },
      { now: new Date('2026-07-15T12:00:00Z'), threshold_cents: 10000 },
    )
    expect(r.minimum_payout_cleared).toBe(false)
  })

  it('coerces NaN / Infinity / negative available_cents to 0', () => {
    const r1 = computePayoutNext(
      { available_cents: Number.NaN, locked_cents: 0, next_release_at: null },
      { now: new Date('2026-07-15T12:00:00Z') },
    )
    expect(r1.minimum_payout_cleared).toBe(false)
    const r2 = computePayoutNext(
      { available_cents: Number.POSITIVE_INFINITY, locked_cents: 0, next_release_at: null },
      { now: new Date('2026-07-15T12:00:00Z') },
    )
    expect(r2.minimum_payout_cleared).toBe(false)
    const r3 = computePayoutNext(
      { available_cents: -100, locked_cents: 0, next_release_at: null },
      { now: new Date('2026-07-15T12:00:00Z') },
    )
    expect(r3.minimum_payout_cleared).toBe(false)
  })
})

describe('computePayoutNext — next_payout_date', () => {
  it('always returns the 1st of next month (mid-month reference)', () => {
    const r = computePayoutNext(zeroSummary, { now: new Date('2026-07-15T12:00:00Z') })
    expect(r.next_payout_date).toBe('2026-08-01')
  })

  it('handles first of the month — moves to the FOLLOWING month', () => {
    // If today is Aug 1, "next" = Sep 1, not Aug 1 (the spec reads
    // "next payout" as the date after today).
    const r = computePayoutNext(zeroSummary, { now: new Date('2026-08-01T08:00:00Z') })
    expect(r.next_payout_date).toBe('2026-09-01')
  })

  it('handles last day of month — moves to the 1st of next month', () => {
    const r = computePayoutNext(zeroSummary, { now: new Date('2026-07-31T23:59:59Z') })
    expect(r.next_payout_date).toBe('2026-08-01')
  })

  it('rolls over from December to next January', () => {
    const r = computePayoutNext(zeroSummary, { now: new Date('2026-12-15T12:00:00Z') })
    expect(r.next_payout_date).toBe('2027-01-01')
  })

  it('handles leap-day scenarios (Feb 28 → March 1, not Feb 29)', () => {
    const r = computePayoutNext(zeroSummary, { now: new Date('2026-02-28T12:00:00Z') })
    expect(r.next_payout_date).toBe('2026-03-01')
  })

  it('falls back gracefully on invalid Date input', () => {
    // Defensive — caller passes an unparseable Date, helper
    // shouldn't throw. Fallback is "1st of next month in UTC"
    // computed against the current clock. We can't pin the exact
    // date, but we CAN pin the shape.
    const r = computePayoutNext(zeroSummary, { now: new Date('not-a-date') as unknown as Date })
    expect(r.next_payout_date).toMatch(/^\d{4}-\d{2}-01$/)
  })

  it('default now() never throws in production-like scenarios', () => {
    // Real-world sanity: no injected `now` → helper uses new Date()
    // internally. Just assert the shape holds.
    const r = computePayoutNext(zeroSummary)
    expect(r.next_payout_date).toMatch(/^\d{4}-\d{2}-01$/)
    expect(r.minimum_payout_cleared).toBe(false)
    expect(r.next_payout_amount_cents).toBe(0)
  })
})

describe('computePayoutNext — next_payout_amount_cents', () => {
  it('floors at 0 even when available_cents is negative / NaN', () => {
    const r1 = computePayoutNext(
      { available_cents: -500, locked_cents: 0, next_release_at: null },
      { now: new Date('2026-07-15T12:00:00Z') },
    )
    expect(r1.next_payout_amount_cents).toBe(0)
    const r2 = computePayoutNext(
      { available_cents: Number.NaN, locked_cents: 0, next_release_at: null },
      { now: new Date('2026-07-15T12:00:00Z') },
    )
    expect(r2.next_payout_amount_cents).toBe(0)
  })

  it('rounds down fractional cents (cents must be whole)', () => {
    // Math.floor with `1234.7` → 1234 (cents are whole numbers)
    const r = computePayoutNext(
      { available_cents: 1234.7 as unknown as number, locked_cents: 0, next_release_at: null },
      { now: new Date('2026-07-15T12:00:00Z') },
    )
    expect(r.next_payout_amount_cents).toBe(1234)
  })

  it('coerces string bigint (PostgREST bigint-as-string defensiveness)', () => {
    // PostgREST returns bigint as a string to preserve precision.
    // The typed `LedgerSummary` already coerces these, but the
    // helper should still be robust if a caller forgets.
    const r = computePayoutNext(
      { available_cents: '7500' as unknown as number, locked_cents: 0, next_release_at: null },
      { now: new Date('2026-07-15T12:00:00Z') },
    )
    expect(r.next_payout_amount_cents).toBe(7500)
  })

  it('returns the full available_cents (no split, no fee) — current spec', () => {
    // Today's spec: the partner's payout method doesn't allow
    // splitting payouts, so the entire available balance is
    // what would go out. Locked funds stay locked until release.
    const r = computePayoutNext(
      { available_cents: 7500, locked_cents: 1200, next_release_at: null },
      { now: new Date('2026-07-15T12:00:00Z') },
    )
    expect(r.next_payout_amount_cents).toBe(7500)
  })
})

describe('computePayoutNext — input immutability', () => {
  it('does not mutate its input summary', () => {
    const input = { available_cents: 7500, locked_cents: 1200, next_release_at: null }
    const snapshot = { ...input }
    computePayoutNext(input, { now: new Date('2026-07-15T12:00:00Z') })
    expect(input).toEqual(snapshot)
  })
})

describe('computePayoutNext — full output shape', () => {
  it('returns all 3 keys with the correct types', () => {
    const r = computePayoutNext(
      { available_cents: 7500, locked_cents: 1200, next_release_at: null },
      { now: new Date('2026-07-15T12:00:00Z') },
    )
    expect(typeof r.next_payout_date).toBe('string')
    expect(typeof r.next_payout_amount_cents).toBe('number')
    expect(typeof r.minimum_payout_cleared).toBe('boolean')
    expect(Object.keys(r).sort()).toEqual(
      ['minimum_payout_cleared', 'next_payout_amount_cents', 'next_payout_date'].sort(),
    )
  })
})
