// parsePartnerDetailId.test.ts — unit tests for the parsePartnerDetailId
// pure helper. The function is small but the input surface (URL param)
// is hostile (CRLF, sign prefix, decimal, scientific, hex, unicode-digit
// confusables, oversized), so the test budget is wide.

import { describe, it, expect } from 'vitest'
import { parsePartnerDetailId } from './parsePartnerDetailId'

describe('parsePartnerDetailId', () => {
  describe('happy path', () => {
    it('accepts a typical small partner id', () => {
      expect(parsePartnerDetailId('42')).toBe('42')
    })

    it('accepts a single-digit partner id', () => {
      expect(parsePartnerDetailId('1')).toBe('1')
    })

    it('accepts the max safe integer as a string', () => {
      expect(parsePartnerDetailId('9007199254740991')).toBe('9007199254740991')
    })

    it('accepts a 16-digit id', () => {
      expect(parsePartnerDetailId('1234567890123456')).toBe('1234567890123456')
    })
  })

  describe('rejections — empty / null / undefined / non-string', () => {
    it('rejects null', () => {
      expect(parsePartnerDetailId(null)).toBeNull()
    })

    it('rejects undefined', () => {
      expect(parsePartnerDetailId(undefined)).toBeNull()
    })

    it('rejects empty string', () => {
      expect(parsePartnerDetailId('')).toBeNull()
    })

    it('rejects whitespace-only string', () => {
      expect(parsePartnerDetailId('   ')).toBeNull()
    })

    it('rejects non-string types via cast', () => {
      // Force-cast a number — the function's type guard rejects this.
      expect(parsePartnerDetailId(123 as unknown as string)).toBeNull()
      expect(parsePartnerDetailId({} as unknown as string)).toBeNull()
      expect(parsePartnerDetailId([] as unknown as string)).toBeNull()
    })
  })

  describe('rejections — sign prefix / negative', () => {
    it('rejects negative sign prefix', () => {
      expect(parsePartnerDetailId('-1')).toBeNull()
    })

    it('rejects positive sign prefix', () => {
      expect(parsePartnerDetailId('+1')).toBeNull()
    })

    it('rejects large negative', () => {
      expect(parsePartnerDetailId('-9007199254740991')).toBeNull()
    })
  })

  describe('rejections — decimal / scientific / hex', () => {
    it('rejects decimal point', () => {
      expect(parsePartnerDetailId('1.5')).toBeNull()
    })

    it('rejects trailing decimal', () => {
      expect(parsePartnerDetailId('42.')).toBeNull()
    })

    it('rejects leading decimal', () => {
      expect(parsePartnerDetailId('.42')).toBeNull()
    })

    it('rejects scientific notation (lowercase e)', () => {
      expect(parsePartnerDetailId('1e5')).toBeNull()
    })

    it('rejects scientific notation (uppercase E)', () => {
      expect(parsePartnerDetailId('1E5')).toBeNull()
    })

    it('rejects hex prefix lowercase', () => {
      expect(parsePartnerDetailId('0x10')).toBeNull()
    })

    it('rejects hex prefix uppercase', () => {
      expect(parsePartnerDetailId('0X10')).toBeNull()
    })

    it('rejects hex chars', () => {
      expect(parsePartnerDetailId('deadbeef')).toBeNull()
    })
  })

  describe('rejections — leading zeros / special', () => {
    it('rejects zero', () => {
      // Zero is technically a valid positive integer but partner ids
      // start at 1 — zero in the URL means a tampered/templated link.
      expect(parsePartnerDetailId('0')).toBeNull()
    })

    it('rejects leading zero on multi-digit', () => {
      // "042" would coerce to 42 but the contract is decimal-only with
      // no padding.
      expect(parsePartnerDetailId('042')).toBeNull()
    })
  })

  describe('rejections — size / range', () => {
    it('rejects 17-digit id (overflows safe int)', () => {
      // Number.MAX_SAFE_INTEGER = 9007199254740991 (16 digits).
      // 10000000000000000 (17 digits) overflows Number's safe range.
      expect(parsePartnerDetailId('10000000000000000')).toBeNull()
    })

    it('rejects 100-digit id', () => {
      const huge = '9'.repeat(100)
      expect(parsePartnerDetailId(huge)).toBeNull()
    })
  })

  describe('rejections — whitespace / control / injection', () => {
    it('trims surrounding whitespace (matches customer-detail pattern)', () => {
      // " 42 " — we trim then validate (matches the customer-detail
      // parseCustomerDetailId pattern). Next.js URL-encodes spaces as
      // %20 so spaces never appear in raw route params; trimming is a
      // defensive belt-and-suspenders, not a critical safety check.
      expect(parsePartnerDetailId(' 42 ')).toBe('42')
    })

    it('rejects embedded whitespace', () => {
      expect(parsePartnerDetailId('4 2')).toBeNull()
    })

    it('rejects tab character', () => {
      expect(parsePartnerDetailId('4\t2')).toBeNull()
    })

    it('rejects newline', () => {
      expect(parsePartnerDetailId('4\n2')).toBeNull()
    })

    it('rejects CRLF', () => {
      expect(parsePartnerDetailId('4\r\n2')).toBeNull()
    })

    it('rejects SQL injection-shaped string', () => {
      expect(parsePartnerDetailId('1 OR 1=1')).toBeNull()
      expect(parsePartnerDetailId("1'; DROP TABLE partners; --")).toBeNull()
    })

    it('rejects shell injection-shaped string', () => {
      expect(parsePartnerDetailId('$(rm -rf /)')).toBeNull()
      expect(parsePartnerDetailId('`whoami`')).toBeNull()
    })

    it('rejects unicode-digit confusables', () => {
      // Arabic-Indic digit 4 (U+0664) is visually identical to ASCII 4
      // but won't match /^[1-9][0-9]*$/. Defense against IDN-style
      // attacks.
      expect(parsePartnerDetailId('\u06642')).toBeNull()
    })

    it('rejects RTL-override character', () => {
      expect(parsePartnerDetailId('\u202E42')).toBeNull()
    })

    it('rejects zero-width characters', () => {
      expect(parsePartnerDetailId('4\u200B2')).toBeNull()
    })
  })

  describe('rejections — letters / non-numeric chars', () => {
    it('rejects pure alphabetic', () => {
      expect(parsePartnerDetailId('abc')).toBeNull()
    })

    it('rejects mixed alphanumeric', () => {
      expect(parsePartnerDetailId('42abc')).toBeNull()
      expect(parsePartnerDetailId('abc42')).toBeNull()
    })

    it('rejects dash', () => {
      expect(parsePartnerDetailId('1-2')).toBeNull()
    })

    it('rejects slash', () => {
      expect(parsePartnerDetailId('1/2')).toBeNull()
    })

    it('rejects curly braces (JSON-shaped)', () => {
      expect(parsePartnerDetailId('{"id":42}')).toBeNull()
    })
  })
})