// Tests for the admin affiliates list pure helpers (types.ts).
//
// Covers: parseAffiliateFilters, affiliateFiltersToRpcPayload,
// formatConversionRate, sort/status label maps. Pure helpers — no
// I/O, no mocking required. Run via `pnpm test`.

import { describe, it, expect } from 'vitest'
import {
  AFFILIATE_SORT_KEYS,
  AFFILIATE_STATUS_FILTERS,
  AFFILIATE_STATUS_LABEL,
  DEFAULT_AFFILIATE_SORT,
  affiliateFiltersToRpcPayload,
  formatConversionRate,
  parseAffiliateFilters,
} from './types'

describe('AFFILIATE_STATUS_FILTERS', () => {
  it('has the three expected values', () => {
    expect([...AFFILIATE_STATUS_FILTERS].sort()).toEqual(
      ['approved', 'pending', 'suspended'].sort(),
    )
  })

  it('is readonly at the type level (frozen tuple)', () => {
    // The runtime tuple is mutable; the type-level readonly is what
    // protects callers from accidental mutation. This test just confirms
    // the runtime length is stable.
    expect(AFFILIATE_STATUS_FILTERS.length).toBe(3)
  })
})

describe('AFFILIATE_SORT_KEYS', () => {
  it('has 10 sort keys (5 columns × 2 directions)', () => {
    expect(AFFILIATE_SORT_KEYS.length).toBe(10)
  })

  it('every key has a _asc or _desc suffix', () => {
    for (const k of AFFILIATE_SORT_KEYS) {
      expect(k.endsWith('_asc') || k.endsWith('_desc')).toBe(true)
    }
  })

  it('default sort is earned_desc', () => {
    expect(DEFAULT_AFFILIATE_SORT).toBe('earned_desc')
  })
})

describe('AFFILIATE_STATUS_LABEL', () => {
  it('has a label for every status value', () => {
    for (const s of AFFILIATE_STATUS_FILTERS) {
      expect(AFFILIATE_STATUS_LABEL[s]).toBeTruthy()
      expect(typeof AFFILIATE_STATUS_LABEL[s]).toBe('string')
    }
  })

  it('labels are human-readable (not snake_case)', () => {
    expect(AFFILIATE_STATUS_LABEL.pending).not.toMatch(/^[a-z_]+$/)
    expect(AFFILIATE_STATUS_LABEL.approved).not.toMatch(/^[a-z_]+$/)
    expect(AFFILIATE_STATUS_LABEL.suspended).not.toMatch(/^[a-z_]+$/)
  })
})

describe('parseAffiliateFilters', () => {
  it('returns all-null when called with null', () => {
    expect(parseAffiliateFilters(null)).toEqual({
      status: null,
      joinedFrom: null,
      joinedTo: null,
      q: null,
    })
  })

  it('returns all-null when called with undefined', () => {
    expect(parseAffiliateFilters(undefined)).toEqual({
      status: null,
      joinedFrom: null,
      joinedTo: null,
      q: null,
    })
  })

  it('returns all-null when called with an empty object', () => {
    expect(parseAffiliateFilters({})).toEqual({
      status: null,
      joinedFrom: null,
      joinedTo: null,
      q: null,
    })
  })

  it('parses a valid status', () => {
    expect(parseAffiliateFilters({ status: 'pending' }).status).toBe('pending')
    expect(parseAffiliateFilters({ status: 'approved' }).status).toBe('approved')
    expect(parseAffiliateFilters({ status: 'suspended' }).status).toBe('suspended')
  })

  it('drops a malformed status (not in the allowlist)', () => {
    expect(parseAffiliateFilters({ status: 'garbage' }).status).toBeNull()
    expect(parseAffiliateFilters({ status: 'PENDING' }).status).toBeNull() // case-sensitive
    expect(parseAffiliateFilters({ status: 'rejected' }).status).toBeNull() // not a valid value
    expect(parseAffiliateFilters({ status: '' }).status).toBeNull()
  })

  it('parses a valid ISO date', () => {
    expect(parseAffiliateFilters({ joinedFrom: '2026-06-01' }).joinedFrom).toBe('2026-06-01')
    expect(parseAffiliateFilters({ joinedTo: '2026-06-30' }).joinedTo).toBe('2026-06-30')
  })

  it('drops malformed dates', () => {
    expect(parseAffiliateFilters({ joinedFrom: '2026-13-01' }).joinedFrom).toBeNull() // month > 12
    expect(parseAffiliateFilters({ joinedFrom: '2026-02-30' }).joinedFrom).toBeNull() // day > Feb
    expect(parseAffiliateFilters({ joinedFrom: '06/01/2026' }).joinedFrom).toBeNull() // wrong format
    expect(parseAffiliateFilters({ joinedFrom: '2026-6-1' }).joinedFrom).toBeNull() // not zero-padded
    expect(parseAffiliateFilters({ joinedFrom: 'tomorrow' }).joinedFrom).toBeNull()
    expect(parseAffiliateFilters({ joinedFrom: '' }).joinedFrom).toBeNull()
  })

  it('parses a free-text q', () => {
    expect(parseAffiliateFilters({ q: 'klaas' }).q).toBe('klaas')
    expect(parseAffiliateFilters({ q: 'klaas@example.com' }).q).toBe('klaas@example.com')
  })

  it('trims + slices q to 100 chars', () => {
    const long = 'x'.repeat(150)
    const result = parseAffiliateFilters({ q: long })
    expect(result.q).toBe('x'.repeat(100))
  })

  it('drops a whitespace-only q', () => {
    expect(parseAffiliateFilters({ q: '   ' }).q).toBeNull()
  })

  it('handles array values (takes the first)', () => {
    expect(parseAffiliateFilters({ status: ['pending', 'approved'] }).status).toBe('pending')
    expect(parseAffiliateFilters({ q: ['first', 'second'] }).q).toBe('first')
  })

  it('combines all fields when present', () => {
    expect(
      parseAffiliateFilters({
        status: 'approved',
        joinedFrom: '2026-01-01',
        joinedTo: '2026-12-31',
        q: 'klaas',
      }),
    ).toEqual({
      status: 'approved',
      joinedFrom: '2026-01-01',
      joinedTo: '2026-12-31',
      q: 'klaas',
    })
  })

  it('does NOT mutate the input', () => {
    const input = { status: 'pending' }
    const snapshot = { ...input }
    parseAffiliateFilters(input)
    expect(input).toEqual(snapshot)
  })
})

describe('affiliateFiltersToRpcPayload', () => {
  it('emits only set fields', () => {
    expect(
      affiliateFiltersToRpcPayload({
        status: null,
        joinedFrom: null,
        joinedTo: null,
        q: null,
      }),
    ).toEqual({})
  })

  it('emits all fields when set', () => {
    expect(
      affiliateFiltersToRpcPayload({
        status: 'approved',
        joinedFrom: '2026-01-01',
        joinedTo: '2026-12-31',
        q: 'klaas',
      }),
    ).toEqual({
      status: 'approved',
      joinedFrom: '2026-01-01',
      joinedTo: '2026-12-31',
      q: 'klaas',
    })
  })
})

describe('formatConversionRate', () => {
  it('returns "—" when clicks is 0 (no conversion signal)', () => {
    expect(formatConversionRate(0, 0)).toBe('—')
    expect(formatConversionRate(5, 0)).toBe('—')
  })

  it('returns "—" when clicks or conversions is not finite', () => {
    expect(formatConversionRate(NaN, 100)).toBe('—')
    expect(formatConversionRate(5, Infinity)).toBe('—')
    expect(formatConversionRate(5, NaN)).toBe('—')
  })

  it('formats a simple 5% rate', () => {
    // 5 conversions / 100 clicks = 5.0%
    expect(formatConversionRate(5, 100)).toBe('5.0%')
  })

  it('formats a sub-1% rate', () => {
    // 1 conversion / 200 clicks = 0.5%
    expect(formatConversionRate(1, 200)).toBe('0.5%')
  })

  it('clamps negative conversions to 0% (defensive)', () => {
    // The function uses Math.max(0, conversions) so a negative input
    // (which shouldn't happen in practice but could from a data
    // anomaly or a manual adjustment) renders as 0.0% rather than a
    // misleading negative percentage. The coercion happens BEFORE the
    // division.
    expect(formatConversionRate(-1, 100)).toBe('0.0%')
    expect(formatConversionRate(-100, 50)).toBe('0.0%')
  })

  it('uses 1 decimal place (per spec OQ #3)', () => {
    // 33 conversions / 1000 clicks = 3.3%
    expect(formatConversionRate(33, 1000)).toBe('3.3%')
  })

  it('handles fractional click counts', () => {
    // Both clicks and conversions are integers in practice, but the
    // function should not crash on a fraction.
    expect(formatConversionRate(2.5, 100)).toBe('2.5%')
  })
})