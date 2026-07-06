// Unit tests for the pure helpers in `types.ts`.
// Covers: parseCustomerFilters + filtersToRpcPayload + riskScoreBand +
// RISK_BAND_LABEL.

import { describe, expect, it } from 'vitest'
import {
  CUSTOMER_ROLE_FILTERS,
  CUSTOMER_SORT_KEYS,
  CUSTOMER_STATUS_FILTERS,
  DEFAULT_CUSTOMER_SORT,
  RISK_BAND_LABEL,
  filtersToRpcPayload,
  parseCustomerFilters,
  riskScoreBand,
  type ParsedCustomerFilters,
} from './types'

describe('parseCustomerFilters', () => {
  it('returns all-null when sp is null', () => {
    const out = parseCustomerFilters(null)
    expect(out).toEqual({
      role: null,
      status: null,
      signupFrom: null,
      signupTo: null,
      spendMinCents: null,
      spendMaxCents: null,
      riskMin: null,
      riskMax: null,
      q: null,
    })
  })

  it('returns all-null when sp is undefined', () => {
    const out = parseCustomerFilters(undefined)
    expect(out.role).toBe(null)
    expect(out.q).toBe(null)
  })

  it('returns all-null when sp is empty', () => {
    const out = parseCustomerFilters({})
    expect(out.role).toBe(null)
  })

  it('parses a valid role filter', () => {
    const out = parseCustomerFilters({ role: 'partner' })
    expect(out.role).toBe('partner')
  })

  it('ignores an invalid role filter', () => {
    const out = parseCustomerFilters({ role: 'superhero' })
    expect(out.role).toBe(null)
  })

  it('parses a valid status filter', () => {
    expect(parseCustomerFilters({ status: 'active' }).status).toBe('active')
    expect(parseCustomerFilters({ status: 'suspended' }).status).toBe('suspended')
    expect(parseCustomerFilters({ status: 'banned' }).status).toBe('banned')
  })

  it('ignores an invalid status filter', () => {
    expect(parseCustomerFilters({ status: 'gone' }).status).toBe(null)
  })

  it('parses valid signup date filters', () => {
    const out = parseCustomerFilters({ signupFrom: '2026-01-01', signupTo: '2026-12-31' })
    expect(out.signupFrom).toBe('2026-01-01')
    expect(out.signupTo).toBe('2026-12-31')
  })

  it('rejects malformed signup date filters', () => {
    expect(parseCustomerFilters({ signupFrom: '2026/01/01' }).signupFrom).toBe(null)
    expect(parseCustomerFilters({ signupFrom: 'not-a-date' }).signupFrom).toBe(null)
    expect(parseCustomerFilters({ signupTo: '2026-13-01' }).signupTo).toBe(null)
  })

  it('parses spend min/max cents', () => {
    const out = parseCustomerFilters({ spendMinCents: '1000', spendMaxCents: '50000' })
    expect(out.spendMinCents).toBe(1000)
    expect(out.spendMaxCents).toBe(50000)
  })

  it('ignores non-numeric spend values', () => {
    expect(parseCustomerFilters({ spendMinCents: 'abc' }).spendMinCents).toBe(null)
    expect(parseCustomerFilters({ spendMaxCents: '-100' }).spendMaxCents).toBe(null)
  })

  it('ignores negative spend (zero-floored at the RPC)', () => {
    expect(parseCustomerFilters({ spendMinCents: '-1' }).spendMinCents).toBe(null)
  })

  it('parses risk min/max (0-100)', () => {
    const out = parseCustomerFilters({ riskMin: '0', riskMax: '100' })
    expect(out.riskMin).toBe(0)
    expect(out.riskMax).toBe(100)
  })

  it('clamps risk to 0-100', () => {
    expect(parseCustomerFilters({ riskMin: '150' }).riskMin).toBe(null)
    expect(parseCustomerFilters({ riskMax: '-1' }).riskMax).toBe(null)
  })

  it('parses search query and trims', () => {
    expect(parseCustomerFilters({ q: '  alice  ' }).q).toBe('alice')
  })

  it('drops empty search query after trim', () => {
    expect(parseCustomerFilters({ q: '   ' }).q).toBe(null)
  })

  it('caps search query at 100 chars', () => {
    const long = 'a'.repeat(200)
    const out = parseCustomerFilters({ q: long })
    expect(out.q?.length).toBe(100)
  })

  it('handles array values (takes the first)', () => {
    const out = parseCustomerFilters({ role: ['partner', 'customer'] })
    expect(out.role).toBe('partner')
  })

  it('rejects empty array values', () => {
    expect(parseCustomerFilters({ role: [] }).role).toBe(null)
  })

  it('parses a full bag', () => {
    const out = parseCustomerFilters({
      role: 'customer',
      status: 'suspended',
      signupFrom: '2026-01-01',
      signupTo: '2026-06-30',
      spendMinCents: '5000',
      spendMaxCents: '100000',
      riskMin: '30',
      riskMax: '70',
      q: 'alice',
    })
    expect(out).toEqual({
      role: 'customer',
      status: 'suspended',
      signupFrom: '2026-01-01',
      signupTo: '2026-06-30',
      spendMinCents: 5000,
      spendMaxCents: 100000,
      riskMin: 30,
      riskMax: 70,
      q: 'alice',
    })
  })
})

describe('filtersToRpcPayload', () => {
  it('drops null fields', () => {
    const p: ParsedCustomerFilters = {
      role: null,
      status: null,
      signupFrom: null,
      signupTo: null,
      spendMinCents: null,
      spendMaxCents: null,
      riskMin: null,
      riskMax: null,
      q: null,
    }
    expect(filtersToRpcPayload(p)).toEqual({})
  })

  it('preserves zero values (not dropped as null)', () => {
    const p: ParsedCustomerFilters = {
      role: null,
      status: null,
      signupFrom: null,
      signupTo: null,
      spendMinCents: 0,
      spendMaxCents: null,
      riskMin: 0,
      riskMax: null,
      q: null,
    }
    expect(filtersToRpcPayload(p)).toEqual({ spendMinCents: 0, riskMin: 0 })
  })

  it('preserves a full filter bag', () => {
    const p: ParsedCustomerFilters = {
      role: 'customer',
      status: 'active',
      signupFrom: '2026-01-01',
      signupTo: '2026-12-31',
      spendMinCents: 100,
      spendMaxCents: 1000,
      riskMin: 10,
      riskMax: 90,
      q: 'alice',
    }
    expect(filtersToRpcPayload(p)).toEqual({
      role: 'customer',
      status: 'active',
      signupFrom: '2026-01-01',
      signupTo: '2026-12-31',
      spendMinCents: 100,
      spendMaxCents: 1000,
      riskMin: 10,
      riskMax: 90,
      q: 'alice',
    })
  })
})

describe('riskScoreBand', () => {
  it('maps 0-30 → normal', () => {
    expect(riskScoreBand(0)).toBe('normal')
    expect(riskScoreBand(15)).toBe('normal')
    expect(riskScoreBand(30)).toBe('normal')
  })

  it('maps 31-60 → watch', () => {
    expect(riskScoreBand(31)).toBe('watch')
    expect(riskScoreBand(45)).toBe('watch')
    expect(riskScoreBand(60)).toBe('watch')
  })

  it('maps 61-80 → high', () => {
    expect(riskScoreBand(61)).toBe('high')
    expect(riskScoreBand(70)).toBe('high')
    expect(riskScoreBand(80)).toBe('high')
  })

  it('maps 81-100 → severe', () => {
    expect(riskScoreBand(81)).toBe('severe')
    expect(riskScoreBand(95)).toBe('severe')
    expect(riskScoreBand(100)).toBe('severe')
  })

  it('clamps negative scores to normal', () => {
    expect(riskScoreBand(-5)).toBe('normal')
  })

  it('clamps scores > 100 to severe', () => {
    expect(riskScoreBand(150)).toBe('severe')
  })

  it('handles non-finite scores', () => {
    expect(riskScoreBand(Number.NaN)).toBe('normal')
    expect(riskScoreBand(Number.POSITIVE_INFINITY)).toBe('severe')
    expect(riskScoreBand(Number.NEGATIVE_INFINITY)).toBe('normal')
  })
})

describe('RISK_BAND_LABEL', () => {
  it('has a label for every band', () => {
    expect(RISK_BAND_LABEL.normal).toBe('Normal')
    expect(RISK_BAND_LABEL.watch).toBe('Watch')
    expect(RISK_BAND_LABEL.high).toBe('High')
    expect(RISK_BAND_LABEL.severe).toBe('Severe')
  })
})

describe('constant arrays', () => {
  it('CUSTOMER_ROLE_FILTERS has 3 values', () => {
    expect(CUSTOMER_ROLE_FILTERS).toEqual(['customer', 'partner', 'affiliate'])
  })

  it('CUSTOMER_STATUS_FILTERS has 3 values', () => {
    expect(CUSTOMER_STATUS_FILTERS).toEqual(['active', 'suspended', 'banned'])
  })

  it('CUSTOMER_SORT_KEYS has 16 values (8 columns × asc/desc)', () => {
    expect(CUSTOMER_SORT_KEYS.length).toBe(16)
  })

  it('DEFAULT_CUSTOMER_SORT is spend_desc', () => {
    expect(DEFAULT_CUSTOMER_SORT).toBe('spend_desc')
  })
})