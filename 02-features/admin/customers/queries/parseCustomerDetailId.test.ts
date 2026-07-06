// parseCustomerDetailId.test.ts — unit tests for the pure UUID parser.
// Pattern matches `parseCustomerFilters.test.ts` + the other parser
// tests in this module.

import { describe, expect, it } from 'vitest'
import { parseCustomerDetailId } from './parseCustomerDetailId'

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000'

describe('parseCustomerDetailId', () => {
  describe('happy path', () => {
    it('returns the lowercase canonical form for a valid UUID', () => {
      expect(parseCustomerDetailId(VALID_UUID)).toBe(VALID_UUID)
    })

    it('lowercases uppercase hex', () => {
      const upper = '550E8400-E29B-41D4-A716-446655440000'
      expect(parseCustomerDetailId(upper)).toBe(VALID_UUID)
    })

    it('trims surrounding whitespace', () => {
      expect(parseCustomerDetailId(`  ${VALID_UUID}  `)).toBe(VALID_UUID)
    })
  })

  describe('rejection', () => {
    it('rejects null', () => {
      expect(parseCustomerDetailId(null)).toBeNull()
    })

    it('rejects undefined', () => {
      expect(parseCustomerDetailId(undefined)).toBeNull()
    })

    it('rejects empty string', () => {
      expect(parseCustomerDetailId('')).toBeNull()
    })

    it('rejects whitespace-only string', () => {
      expect(parseCustomerDetailId('   ')).toBeNull()
    })

    it('rejects non-uuid strings', () => {
      expect(parseCustomerDetailId('not-a-uuid')).toBeNull()
      expect(parseCustomerDetailId('12345')).toBeNull()
      expect(parseCustomerDetailId('foo-bar-baz')).toBeNull()
    })

    it('rejects UUID without dashes', () => {
      expect(parseCustomerDetailId('550e8400e29b41d4a716446655440000')).toBeNull()
    })

    it('rejects UUID with wrong segment lengths', () => {
      expect(parseCustomerDetailId('550e840-e29b-41d4-a716-446655440000')).toBeNull()
      expect(parseCustomerDetailId('550e8400-e29b-41d4-a716-44665544000')).toBeNull()
    })

    it('rejects UUID with non-hex characters', () => {
      expect(parseCustomerDetailId('zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz')).toBeNull()
    })

    it('rejects SQL-injection-shaped garbage', () => {
      expect(parseCustomerDetailId("'; DROP TABLE profiles;--")).toBeNull()
      expect(parseCustomerDetailId("' OR '1'='1")).toBeNull()
    })

    it('rejects CRLF injection', () => {
      expect(parseCustomerDetailId(`${VALID_UUID}\r\nattack`)).toBeNull()
    })

    it('rejects oversized strings', () => {
      expect(parseCustomerDetailId('a'.repeat(100))).toBeNull()
    })

    it('rejects non-string inputs', () => {
      // @ts-expect-error testing runtime guard
      expect(parseCustomerDetailId(123)).toBeNull()
      // @ts-expect-error testing runtime guard
      expect(parseCustomerDetailId({})).toBeNull()
      // @ts-expect-error testing runtime guard
      expect(parseCustomerDetailId([])).toBeNull()
    })
  })
})