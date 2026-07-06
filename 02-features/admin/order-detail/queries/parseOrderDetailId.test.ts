// Test suite for parseOrderDetailId — covers the canonical bigint
// accept + every documented rejection branch + the Postgres-bigint
// range bound.

import { describe, expect, it } from 'vitest'
import { parseOrderDetailId } from './parseOrderDetailId'

describe('parseOrderDetailId', () => {
  it('accepts a canonical small positive bigint', () => {
    expect(parseOrderDetailId('1')).toBe('1')
    expect(parseOrderDetailId('12345')).toBe('12345')
    expect(parseOrderDetailId('987654321')).toBe('987654321')
  })

  it('accepts a value at the Postgres bigint max', () => {
    expect(parseOrderDetailId('9223372036854775807')).toBe('9223372036854775807')
  })

  it('trims surrounding whitespace before validating', () => {
    expect(parseOrderDetailId('  42  ')).toBe('42')
    expect(parseOrderDetailId('\t42\n')).toBe('42')
  })

  it('rejects empty input', () => {
    expect(parseOrderDetailId('')).toBeNull()
    expect(parseOrderDetailId('   ')).toBeNull()
  })

  it('rejects null / undefined / non-string input', () => {
    expect(parseOrderDetailId(null)).toBeNull()
    expect(parseOrderDetailId(undefined)).toBeNull()
    // @ts-expect-error — testing runtime safety against bad types
    expect(parseOrderDetailId(42)).toBeNull()
    // @ts-expect-error — testing runtime safety
    expect(parseOrderDetailId({})).toBeNull()
  })

  it('rejects zero', () => {
    expect(parseOrderDetailId('0')).toBeNull()
  })

  it('rejects negative numbers', () => {
    expect(parseOrderDetailId('-1')).toBeNull()
    expect(parseOrderDetailId('-9223372036854775808')).toBeNull()
  })

  it('rejects signed-prefix forms', () => {
    expect(parseOrderDetailId('+1')).toBeNull()
    expect(parseOrderDetailId('+42')).toBeNull()
  })

  it('rejects decimal numbers', () => {
    expect(parseOrderDetailId('1.5')).toBeNull()
    expect(parseOrderDetailId('1.0')).toBeNull()
    expect(parseOrderDetailId('0.5')).toBeNull()
  })

  it('rejects scientific notation', () => {
    expect(parseOrderDetailId('1e3')).toBeNull()
    expect(parseOrderDetailId('1E5')).toBeNull()
    expect(parseOrderDetailId('1e+10')).toBeNull()
  })

  it('rejects leading-zero forms', () => {
    expect(parseOrderDetailId('007')).toBeNull()
    expect(parseOrderDetailId('01')).toBeNull()
    expect(parseOrderDetailId('042')).toBeNull()
  })

  it('rejects strings with non-numeric characters', () => {
    expect(parseOrderDetailId('12a')).toBeNull()
    expect(parseOrderDetailId('abc')).toBeNull()
    expect(parseOrderDetailId('1 2')).toBeNull()
    expect(parseOrderDetailId('1; drop table orders;--')).toBeNull()
    expect(parseOrderDetailId("1'")).toBeNull()
  })

  it('rejects hex / unicode / control-character confusables', () => {
    expect(parseOrderDetailId('0x10')).toBeNull()
    expect(parseOrderDetailId('１')).toBeNull() // fullwidth digit one
    expect(parseOrderDetailId('1​')).toBeNull() // zero-width space
    expect(parseOrderDetailId('1\u200B')).toBeNull()
    expect(parseOrderDetailId('1‎')).toBeNull() // RTL override
  })

  it('rejects CRLF / newline / tab injection shapes', () => {
    expect(parseOrderDetailId('1\r\nfake')).toBeNull()
    expect(parseOrderDetailId('1\nfake')).toBeNull()
    expect(parseOrderDetailId('1\rfake')).toBeNull()
  })

  it('rejects oversized strings', () => {
    expect(parseOrderDetailId('1'.repeat(20))).toBeNull()
    expect(parseOrderDetailId('9'.repeat(25))).toBeNull()
  })

  it('rejects values above Postgres bigint max', () => {
    // 19 nines > 9223372036854775807 — same length, but the BigInt
    // range check rejects.
    expect(parseOrderDetailId('9999999999999999999')).toBeNull()
  })
})
