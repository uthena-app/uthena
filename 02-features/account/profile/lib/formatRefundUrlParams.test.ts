// formatRefundUrlParams.test.ts — unit tests for the /account/orders/[id]
// /refund/sent pure helpers. Tests cover:
//
//   parseOrderId / parseRefundId
//     - valid digit strings → integer
//     - leading-zero strings (e.g. '007') → integer (parses as 7)
//     - decimal strings ('12.5'), scientific ('1e3'), signed ('-1')
//       → null
//     - non-numeric ('abc', '12abc', '') → null
//     - null / undefined → null
//     - past-MAX_SAFE_INTEGER → null
//     - zero → null (ids are 1-indexed; a 0 is meaningless)
//
//   formatRefundReference
//     - valid integer → 'R-<id>'
//     - null / undefined → 'R-?'
//     - non-finite (NaN, Infinity) → 'R-?'
//     - non-integer (12.5) → 'R-?'
//     - 0 / negative → 'R-?'
//     - past-MAX_SAFE_INTEGER → 'R-<id>' (format is permissive; the
//       parse gate has already rejected this case upstream)
//
// Pure functions, no mocks. Runs in < 5ms.

import { describe, expect, it } from 'vitest'
import {
  formatRefundReference,
  parseOrderId,
  parseRefundId,
} from './formatRefundUrlParams'

describe('parseOrderId / parseRefundId — happy path', () => {
  it('parses a plain digit string', () => {
    expect(parseOrderId('12345')).toBe(12345)
    expect(parseRefundId('42')).toBe(42)
  })

  it('parses a single-digit string', () => {
    expect(parseOrderId('1')).toBe(1)
    expect(parseRefundId('9')).toBe(9)
  })

  it('parses a leading-zero string (the leading zeros are stripped by Number coercion)', () => {
    // '007' is digits-only so it passes the regex; Number('007') is 7.
    // We accept this rather than treat it as an error — the canonical
    // URL never has leading zeros, but a tampered request that does
    // still points at the right row.
    expect(parseOrderId('007')).toBe(7)
    expect(parseRefundId('00042')).toBe(42)
  })

  it('parses up to MAX_SAFE_INTEGER', () => {
    expect(parseOrderId(String(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER)
  })
})

describe('parseOrderId / parseRefundId — defensive rejections', () => {
  it('rejects null / undefined / empty string', () => {
    expect(parseOrderId(null)).toBeNull()
    expect(parseOrderId(undefined)).toBeNull()
    expect(parseOrderId('')).toBeNull()
    expect(parseRefundId(null)).toBeNull()
    expect(parseRefundId(undefined)).toBeNull()
    expect(parseRefundId('')).toBeNull()
  })

  it('rejects non-numeric strings', () => {
    expect(parseOrderId('abc')).toBeNull()
    expect(parseOrderId('12abc')).toBeNull()
    expect(parseOrderId('abc12')).toBeNull()
    expect(parseOrderId('NaN')).toBeNull()
    expect(parseOrderId('Infinity')).toBeNull()
  })

  it('rejects decimal / scientific / signed strings (parseInt is leaky; we tighten the gate)', () => {
    // parseInt('12.5') returns 12 — we refuse rather than silently
    // accept the prefix.
    expect(parseOrderId('12.5')).toBeNull()
    expect(parseOrderId('1.0')).toBeNull()
    // parseInt('1e3') returns 1 — refuse.
    expect(parseOrderId('1e3')).toBeNull()
    // parseInt('-1') returns -1 — refuse (we require > 0).
    expect(parseOrderId('-1')).toBeNull()
    expect(parseOrderId('+1')).toBeNull()
  })

  it('rejects zero (ids are 1-indexed; 0 is meaningless)', () => {
    expect(parseOrderId('0')).toBeNull()
    expect(parseRefundId('0')).toBeNull()
  })

  it('rejects past-MAX_SAFE_INTEGER (silent precision loss would let two distinct ids collapse)', () => {
    expect(parseOrderId(String(Number.MAX_SAFE_INTEGER + 1))).toBeNull()
    expect(parseOrderId(String(Number.MAX_SAFE_INTEGER + 100))).toBeNull()
  })

  it('rejects whitespace-only / whitespace-padded strings', () => {
    expect(parseOrderId(' ')).toBeNull()
    expect(parseOrderId(' 1')).toBeNull()
    expect(parseOrderId('1 ')).toBeNull()
  })
})

describe('formatRefundReference', () => {
  it('formats a positive integer as R-<id>', () => {
    expect(formatRefundReference(12345)).toBe('R-12345')
    expect(formatRefundReference(1)).toBe('R-1')
  })

  it('formats a safe large integer', () => {
    expect(formatRefundReference(Number.MAX_SAFE_INTEGER)).toBe(
      `R-${Number.MAX_SAFE_INTEGER}`,
    )
  })

  it('collapses null / undefined to R-? (defense in depth — the page should never render an invalid ref)', () => {
    expect(formatRefundReference(null)).toBe('R-?')
    expect(formatRefundReference(undefined)).toBe('R-?')
  })

  it('collapses NaN / Infinity to R-?', () => {
    expect(formatRefundReference(NaN)).toBe('R-?')
    expect(formatRefundReference(Infinity)).toBe('R-?')
    expect(formatRefundReference(-Infinity)).toBe('R-?')
  })

  it('collapses 0 / negative to R-?', () => {
    expect(formatRefundReference(0)).toBe('R-?')
    expect(formatRefundReference(-1)).toBe('R-?')
  })

  it('collapses non-integer (decimal) to R-? (defense — a refund id is always integer)', () => {
    expect(formatRefundReference(12.5)).toBe('R-?')
    expect(formatRefundReference(1.0001)).toBe('R-?')
  })
})

describe('parseOrderId / parseRefundId — same contract (alias sanity)', () => {
  it('both helpers agree on every sample input', () => {
    const samples = [
      '1', '42', '12345', '0', '-1', 'abc', '', '12.5', '007', '9007199254740992',
      String(Number.MAX_SAFE_INTEGER + 1), null, undefined,
    ]
    for (const s of samples) {
      expect(parseOrderId(s)).toBe(parseRefundId(s))
    }
  })
})
