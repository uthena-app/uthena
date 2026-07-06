// 02-features/partner-portal/format.test.ts — unit tests for the
// partner-portal masking helpers (P6.5 Slice 1).
//
// Pure-function tests, no fixtures, no I/O. Runs in milliseconds.

import { describe, expect, it } from 'vitest'
import { maskAccountNumber, maskEmail, maskRoutingNumber, maskTaxId } from './format'

describe('maskEmail', () => {
  it('masks a typical email to "f***@domain"', () => {
    expect(maskEmail('klaas@example.com')).toBe('k***@example.com')
  })

  it('keeps the full domain unchanged', () => {
    expect(maskEmail('alice@sub.example.co.uk')).toBe('a***@sub.example.co.uk')
  })

  it('lowercases the first char if alpha', () => {
    // 'A***@...' — the first char stays as-is. We don't downcase;
    // email local parts are case-sensitive (RFC 5321). This test
    // pins the behavior so a future refactor doesn't accidentally
    // normalize.
    expect(maskEmail('Alice@Example.com')).toBe('A***@Example.com')
  })

  it('handles IDN / unicode local parts (first grapheme)', () => {
    // 'ü' is a single grapheme but two UTF-16 code units. The
    // helper uses Array.from() so we keep the full 'ü' as the
    // first char, not just 'ü'[0].
    expect(maskEmail('ünïcödé@example.com')).toBe('ü***@example.com')
  })

  it('handles single-char local parts', () => {
    expect(maskEmail('a@example.com')).toBe('a***@example.com')
  })

  it('returns null for empty string', () => {
    expect(maskEmail('')).toBeNull()
  })

  it('returns null for null / undefined', () => {
    expect(maskEmail(null)).toBeNull()
    expect(maskEmail(undefined)).toBeNull()
  })

  it('returns null for non-strings', () => {
    expect(maskEmail(123 as unknown as string)).toBeNull()
  })

  it('returns null for no-@ inputs', () => {
    expect(maskEmail('not-an-email')).toBeNull()
  })

  it('uses lastIndexOf for multi-@ inputs (real-world email rule)', () => {
    // `lastIndexOf('@')` finds the LAST `@`, so everything before
    // it (the local part) is masked and everything after is the
    // domain. 'multi@ple@ats' → local='multi@ple', domain='ats'.
    expect(maskEmail('multi@ple@ats')).toBe('m***@ats')
  })

  it('returns null for @-only inputs', () => {
    expect(maskEmail('@example.com')).toBeNull() // empty local
    expect(maskEmail('alice@')).toBeNull() // empty domain
  })

  it('trims whitespace', () => {
    expect(maskEmail('  klaas@example.com  ')).toBe('k***@example.com')
  })

  it('handles plus addressing', () => {
    expect(maskEmail('alice+tag@example.com')).toBe('a***@example.com')
  })
})

describe('maskRoutingNumber', () => {
  it('masks a 9-digit routing number to *****{last4}', () => {
    expect(maskRoutingNumber('123456789')).toBe('*****6789')
  })

  it('masks with whitespace trimmed', () => {
    expect(maskRoutingNumber('  123456789  ')).toBe('*****6789')
  })

  it('returns null for null / undefined / empty', () => {
    expect(maskRoutingNumber(null)).toBeNull()
    expect(maskRoutingNumber(undefined)).toBeNull()
    expect(maskRoutingNumber('')).toBeNull()
    expect(maskRoutingNumber('   ')).toBeNull()
  })

  it('returns input unchanged when too short to mask', () => {
    // < 5 chars — masking would just produce noise. The caller
    // validates length separately; we don't fake a mask.
    expect(maskRoutingNumber('1234')).toBe('1234')
    expect(maskRoutingNumber('1')).toBe('1')
  })

  it('masks at exactly 5 chars', () => {
    expect(maskRoutingNumber('12345')).toBe('*****2345')
  })

  it('handles routing numbers with formatting characters', () => {
    // Some banks format as "123-456-789". We don't strip
    // non-digits (that's the caller's responsibility for
    // validation). Mask the last 4 chars as-is.
    // '123-456-789' has 11 chars; last 4 chars = '-789'
    expect(maskRoutingNumber('123-456-789')).toBe('*****-789')
    // (The - characters survive because we slice on the string,
    // not the digits. That's a deliberate choice — the mask is
    // for display only, never for re-deriving the original
    // value.)
  })
})

describe('maskAccountNumber', () => {
  it('masks like routing number (last 4)', () => {
    expect(maskAccountNumber('000123456789')).toBe('*****6789')
  })

  it('returns null for null / empty', () => {
    expect(maskAccountNumber(null)).toBeNull()
    expect(maskAccountNumber('')).toBeNull()
  })

  it('returns input unchanged when too short', () => {
    expect(maskAccountNumber('12')).toBe('12')
  })
})

describe('maskTaxId', () => {
  it('masks a US EIN format to ***-**-{last4}', () => {
    expect(maskTaxId('12-3456789')).toBe('***-**-6789')
  })

  it('strips dashes before slicing', () => {
    expect(maskTaxId('123-45-6789')).toBe('***-**-6789')
    expect(maskTaxId('123456789')).toBe('***-**-6789')
  })

  it('returns null for null / empty / non-digit-only', () => {
    expect(maskTaxId(null)).toBeNull()
    expect(maskTaxId(undefined)).toBeNull()
    expect(maskTaxId('')).toBeNull()
    expect(maskTaxId('abc')).toBeNull()
  })

  it('returns "***" for short digit-only inputs', () => {
    expect(maskTaxId('1')).toBe('***')
    expect(maskTaxId('123')).toBe('***')
  })

  it('handles whitespace', () => {
    expect(maskTaxId('  12-3456789  ')).toBe('***-**-6789')
  })
})
