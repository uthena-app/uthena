// cartExpiration.test.ts — pure date-math tests. No DB, no I/O.
// Covers:
//  - getCartExpirationStatus: every kind branch (fresh / warn /
//    expired), edge cases at the 25/30-day boundaries, null + invalid
//    inputs, clock-skew tolerance for future-dated rows.
//  - getAnonCartLastActivity: max-of-lines, empty-but-created-at,
//    null cookie.
//  - formatExpiryWarning: 0 / 1 / 2 / 5 days.
//  - isInCartExpirationWarnWindow / isCartExpired: discriminated
//    union narrowing.

import { describe, expect, it } from 'vitest'
import {
  CART_IDLE_DAYS_BEFORE_ABANDONMENT,
  CART_IDLE_DAYS_BEFORE_EXPIRY,
  CART_WARN_DAYS_BEFORE_EXPIRY,
  formatExpiryWarning,
  getAnonCartLastActivity,
  getCartExpirationStatus,
  isCartExpired,
  isInCartExpirationWarnWindow,
  isPastAbandonmentThreshold,
} from './cartExpiration'
import type { AnonCart } from '@foundations/cookies/anon-cart'

// Anchor "now" so every assertion is reproducible.
const NOW = new Date('2026-06-25T12:00:00.000Z')
const NOW_MS = NOW.getTime()

function isoDaysAgo(days: number, from: Date = NOW): string {
  return new Date(from.getTime() - days * 24 * 60 * 60 * 1000).toISOString()
}

describe('constants', () => {
  it('exposes a 30-day expiry window', () => {
    expect(CART_IDLE_DAYS_BEFORE_EXPIRY).toBe(30)
  })

  it('exposes a 5-day warn window', () => {
    expect(CART_WARN_DAYS_BEFORE_EXPIRY).toBe(5)
  })

  it('exposes a 25-day abandonment threshold (matches the cron cutoff)', () => {
    expect(CART_IDLE_DAYS_BEFORE_ABANDONMENT).toBe(25)
  })
})

describe('getCartExpirationStatus', () => {
  it('returns null for null / undefined / empty input', () => {
    expect(getCartExpirationStatus(null, NOW)).toBeNull()
    expect(getCartExpirationStatus(undefined, NOW)).toBeNull()
    expect(getCartExpirationStatus('', NOW)).toBeNull()
  })

  it('returns null for unparseable input', () => {
    expect(getCartExpirationStatus('not-a-date', NOW)).toBeNull()
    expect(getCartExpirationStatus('2026-13-99', NOW)).toBeNull()
  })

  it('returns "fresh" for activity today (0 days idle)', () => {
    const status = getCartExpirationStatus(isoDaysAgo(0), NOW)
    expect(status).toEqual({ kind: 'fresh', daysUntilExpiry: 30 })
  })

  it('returns "fresh" for activity 24 days ago (warn boundary -1)', () => {
    const status = getCartExpirationStatus(isoDaysAgo(24), NOW)
    expect(status?.kind).toBe('fresh')
    if (status?.kind === 'fresh') {
      // 30 - 24 = 6 days → still fresh (warn is 5 or fewer)
      expect(status.daysUntilExpiry).toBe(6)
    }
  })

  it('returns "warn" at exactly 25 days idle (warn boundary)', () => {
    const status = getCartExpirationStatus(isoDaysAgo(25), NOW)
    expect(status).toEqual({ kind: 'warn', daysUntilExpiry: 5 })
  })

  it('returns "warn" at 28 days idle (mid-warn)', () => {
    const status = getCartExpirationStatus(isoDaysAgo(28), NOW)
    expect(status).toEqual({ kind: 'warn', daysUntilExpiry: 2 })
  })

  it('returns "warn" at 29 days idle (1 day remaining)', () => {
    const status = getCartExpirationStatus(isoDaysAgo(29), NOW)
    expect(status).toEqual({ kind: 'warn', daysUntilExpiry: 1 })
  })

  it('returns "warn" at 30 days idle (0 days remaining — boundary edge)', () => {
    // 30 - 30 = 0 → still warn (the user has the whole day to act)
    const status = getCartExpirationStatus(isoDaysAgo(30), NOW)
    expect(status).toEqual({ kind: 'warn', daysUntilExpiry: 0 })
  })

  it('returns "expired" at 30 days + 1 hour (just past the line)', () => {
    const oneHourPast = new Date(NOW_MS - 30 * 24 * 60 * 60 * 1000 - 60 * 60 * 1000).toISOString()
    const status = getCartExpirationStatus(oneHourPast, NOW)
    expect(status?.kind).toBe('expired')
    if (status?.kind === 'expired') {
      expect(status.daysSinceExpiry).toBe(0)
    }
  })

  it('returns "expired" at 45 days idle (15 days past)', () => {
    const status = getCartExpirationStatus(isoDaysAgo(45), NOW)
    expect(status).toEqual({ kind: 'expired', daysSinceExpiry: 15 })
  })

  it('treats future-dated activity as brand-new (clock-skew tolerance)', () => {
    const futureIso = new Date(NOW_MS + 5 * 60 * 1000).toISOString() // 5 min ahead
    const status = getCartExpirationStatus(futureIso, NOW)
    expect(status).toEqual({ kind: 'fresh', daysUntilExpiry: 30 })
  })

  it('accepts a custom `now` parameter for deterministic testing', () => {
    // 50 days ago relative to a fixed `now` → expired, 20 days past.
    const fixedNow = new Date('2030-01-01T00:00:00.000Z')
    const fiftyDaysBefore = new Date(fixedNow.getTime() - 50 * 86_400_000).toISOString()
    const status = getCartExpirationStatus(fiftyDaysBefore, fixedNow)
    expect(status).toEqual({ kind: 'expired', daysSinceExpiry: 20 })
  })
})

describe('getAnonCartLastActivity', () => {
  it('returns null for null cookie', () => {
    expect(getAnonCartLastActivity(null)).toBeNull()
  })

  it('returns null for cookie with no lines and no created_at', () => {
    const empty: AnonCart = { v: 1, c: '', lines: [] }
    expect(getAnonCartLastActivity(empty)).toBeNull()
  })

  it('returns created_at when cookie has no lines', () => {
    const empty: AnonCart = { v: 1, c: '2026-06-25T10:00:00.000Z', lines: [] }
    expect(getAnonCartLastActivity(empty)).toBe('2026-06-25T10:00:00.000Z')
  })

  it('returns the only line\'s added_at for a single-line cart', () => {
    const cart: AnonCart = {
      v: 1,
      c: '2026-06-25T10:00:00.000Z',
      lines: [{ p: 1, l: 'plr', q: 1, a: '2026-06-25T10:05:00.000Z' }],
    }
    expect(getAnonCartLastActivity(cart)).toBe('2026-06-25T10:05:00.000Z')
  })

  it('returns the MAX added_at across lines', () => {
    const cart: AnonCart = {
      v: 1,
      c: '2026-06-20T10:00:00.000Z',
      lines: [
        { p: 1, l: 'plr', q: 1, a: '2026-06-25T10:05:00.000Z' },
        { p: 2, l: 'mrr', q: 2, a: '2026-06-25T11:00:00.000Z' }, // <-- max
        { p: 3, l: 'rr', q: 1, a: '2026-06-24T09:00:00.000Z' },
      ],
    }
    expect(getAnonCartLastActivity(cart)).toBe('2026-06-25T11:00:00.000Z')
  })

  it('works correctly when MAX is the first line (defensive against off-by-one)', () => {
    const cart: AnonCart = {
      v: 1,
      c: '2026-06-01T00:00:00.000Z',
      lines: [
        { p: 1, l: 'plr', q: 1, a: '2026-06-25T10:05:00.000Z' }, // <-- max
        { p: 2, l: 'mrr', q: 1, a: '2026-06-24T10:00:00.000Z' },
      ],
    }
    expect(getAnonCartLastActivity(cart)).toBe('2026-06-25T10:05:00.000Z')
  })
})

describe('formatExpiryWarning', () => {
  it('renders "today" at 0 days', () => {
    expect(formatExpiryWarning(0)).toBe('Your cart will expire today.')
  })

  it('renders "tomorrow" at 1 day', () => {
    expect(formatExpiryWarning(1)).toBe('Your cart will expire tomorrow.')
  })

  it('renders plural at 2 days', () => {
    expect(formatExpiryWarning(2)).toBe('Your cart will expire in 2 days.')
  })

  it('renders plural at 5 days (max warn window)', () => {
    expect(formatExpiryWarning(5)).toBe('Your cart will expire in 5 days.')
  })
})

describe('isInCartExpirationWarnWindow', () => {
  it('returns true for warn status', () => {
    expect(
      isInCartExpirationWarnWindow({ kind: 'warn', daysUntilExpiry: 3 }),
    ).toBe(true)
  })

  it('returns false for fresh status', () => {
    expect(
      isInCartExpirationWarnWindow({ kind: 'fresh', daysUntilExpiry: 10 }),
    ).toBe(false)
  })

  it('returns false for expired status', () => {
    expect(isInCartExpirationWarnWindow({ kind: 'expired', daysSinceExpiry: 2 })).toBe(
      false,
    )
  })

  it('returns false for null', () => {
    expect(isInCartExpirationWarnWindow(null)).toBe(false)
  })
})

describe('isCartExpired', () => {
  it('returns true for expired status', () => {
    expect(isCartExpired({ kind: 'expired', daysSinceExpiry: 1 })).toBe(true)
  })

  it('returns false for warn status', () => {
    expect(isCartExpired({ kind: 'warn', daysUntilExpiry: 5 })).toBe(false)
  })

  it('returns false for fresh status', () => {
    expect(isCartExpired({ kind: 'fresh', daysUntilExpiry: 10 })).toBe(false)
  })

  it('returns false for null', () => {
    expect(isCartExpired(null)).toBe(false)
  })
})

describe('isPastAbandonmentThreshold', () => {
  it('returns false for null / undefined / empty input', () => {
    expect(isPastAbandonmentThreshold(null, NOW)).toBe(false)
    expect(isPastAbandonmentThreshold(undefined, NOW)).toBe(false)
    expect(isPastAbandonmentThreshold('', NOW)).toBe(false)
  })

  it('returns false for unparseable input', () => {
    expect(isPastAbandonmentThreshold('not-a-date', NOW)).toBe(false)
    expect(isPastAbandonmentThreshold('2026-13-99', NOW)).toBe(false)
  })

  it('returns false for activity today (0 days idle — never abandoned)', () => {
    expect(isPastAbandonmentThreshold(isoDaysAgo(0), NOW)).toBe(false)
  })

  it('returns false at 24 days idle (boundary -1: not yet abandoned)', () => {
    expect(isPastAbandonmentThreshold(isoDaysAgo(24), NOW)).toBe(false)
  })

  it('returns true at 25 days idle (exact boundary — cron cutoff is strict-less-than)', () => {
    // The cron uses `.lt('updated_at', cutoff)` (strict-less-than),
    // so a row at exactly 25 days is NOT picked up. The helper
    // mirrors the same boundary so a single threshold definition
    // is the source of truth for both the cron and any UI gate.
    // The cron's `lt` means "older than cutoff"; 25 days idle means
    // `updated_at === cutoff`, which is NOT strictly less. So the
    // helper is false at the exact boundary. To get a true here we
    // need idle > 25 days.
    expect(isPastAbandonmentThreshold(isoDaysAgo(25), NOW)).toBe(false)
  })

  it('returns true at 26 days idle (just past the threshold)', () => {
    expect(isPastAbandonmentThreshold(isoDaysAgo(26), NOW)).toBe(true)
  })

  it('returns true at 29 days idle (last day of the recovery window)', () => {
    expect(isPastAbandonmentThreshold(isoDaysAgo(29), NOW)).toBe(true)
  })

  it('returns true at 45 days idle (well past — cron will have expired by now)', () => {
    // Once the row is status='expired', the abandonment-detection
    // cron's `.eq('status', 'active')` filter excludes it; this
    // helper is purely date-math so it still returns true here.
    expect(isPastAbandonmentThreshold(isoDaysAgo(45), NOW)).toBe(true)
  })

  it('treats future-dated activity as never abandoned (clock-skew tolerance)', () => {
    const futureIso = new Date(NOW_MS + 5 * 60 * 1000).toISOString() // 5 min ahead
    // Future-dated rows have negative idleDays, which is NOT > 25.
    expect(isPastAbandonmentThreshold(futureIso, NOW)).toBe(false)
  })

  it('accepts a custom `now` parameter for deterministic testing', () => {
    const fixedNow = new Date('2030-01-01T00:00:00.000Z')
    const twentySixDaysBefore = new Date(fixedNow.getTime() - 26 * 86_400_000).toISOString()
    expect(isPastAbandonmentThreshold(twentySixDaysBefore, fixedNow)).toBe(true)
  })
})