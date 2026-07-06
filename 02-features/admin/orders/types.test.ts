// types.test.ts — unit tests for the /admin/orders URL filter bag
// parser. Pure-function tests; no I/O. The parser is the contract
// between the URL params and the typed filter object that flows into
// the RPC payload.

import { describe, expect, it } from 'vitest'

import {
  ORDER_STATUS_LABEL,
  orderFiltersToRpcPayload,
  parseOrderFilters,
  type ParsedOrderFilters,
} from './types'

const EMPTY: ParsedOrderFilters = {
  status: null,
  from: null,
  to: null,
  customerEmail: null,
  affiliateId: null,
  productId: null,
  partnerId: null,
}

describe('parseOrderFilters', () => {
  it('returns the empty filter bag when sp is null', () => {
    expect(parseOrderFilters(null)).toEqual(EMPTY)
  })

  it('returns the empty filter bag when sp is undefined', () => {
    expect(parseOrderFilters(undefined)).toEqual(EMPTY)
  })

  it('returns the empty filter bag for an empty object', () => {
    expect(parseOrderFilters({})).toEqual(EMPTY)
  })

  it('coerces a valid status to the typed enum', () => {
    expect(parseOrderFilters({ status: 'paid' })).toEqual({
      ...EMPTY,
      status: 'paid',
    })
  })

  it('drops a bogus status without rejecting the whole bag', () => {
    expect(parseOrderFilters({ status: 'nosuch' })).toEqual(EMPTY)
  })

  it('accepts every order_status enum value', () => {
    for (const s of [
      'pending',
      'awaiting_payment',
      'paid',
      'fulfilled',
      'refunded',
      'partially_refunded',
      'failed',
      'canceled',
      'fraudulent',
    ] as const) {
      expect(parseOrderFilters({ status: s }).status).toBe(s)
    }
  })

  it('accepts a valid ISO date', () => {
    expect(parseOrderFilters({ from: '2026-06-15' }).from).toBe('2026-06-15')
  })

  it('drops a bogus ISO date (Feb 30)', () => {
    expect(parseOrderFilters({ from: '2026-02-30' }).from).toBeNull()
  })

  it('drops a bogus ISO date (month 13)', () => {
    expect(parseOrderFilters({ from: '2026-13-01' }).from).toBeNull()
  })

  it('drops a non-date from value', () => {
    expect(parseOrderFilters({ from: 'not-a-date' }).from).toBeNull()
  })

  it('parses a customer email with whitespace trimmed', () => {
    expect(parseOrderFilters({ customerEmail: '  jane@example.com  ' }).customerEmail).toBe(
      'jane@example.com',
    )
  })

  it('drops an empty customer email after trim', () => {
    expect(parseOrderFilters({ customerEmail: '   ' }).customerEmail).toBeNull()
  })

  it('caps customer email at 100 chars (defensive)', () => {
    const long = 'a'.repeat(150) + '@x.com'
    expect(parseOrderFilters({ customerEmail: long }).customerEmail).toHaveLength(100)
  })

  it('coerces a positive integer affiliateId', () => {
    expect(parseOrderFilters({ affiliateId: '42' }).affiliateId).toBe(42)
  })

  it('drops a non-numeric affiliateId', () => {
    expect(parseOrderFilters({ affiliateId: 'abc' }).affiliateId).toBeNull()
  })

  it('drops a zero or negative affiliateId', () => {
    expect(parseOrderFilters({ affiliateId: '0' }).affiliateId).toBeNull()
    expect(parseOrderFilters({ affiliateId: '-5' }).affiliateId).toBeNull()
  })

  it('coerces productId and partnerId the same way', () => {
    const out = parseOrderFilters({ productId: '7', partnerId: '11' })
    expect(out.productId).toBe(7)
    expect(out.partnerId).toBe(11)
  })

  it('handles an array value by taking the first element', () => {
    expect(parseOrderFilters({ status: ['paid', 'refunded'] }).status).toBe('paid')
  })

  it('parses a full filter bag with all 7 fields populated', () => {
    const out = parseOrderFilters({
      status: 'paid',
      from: '2026-01-01',
      to: '2026-06-30',
      customerEmail: 'jane@example.com',
      affiliateId: '42',
      productId: '7',
      partnerId: '11',
    })
    expect(out).toEqual({
      status: 'paid',
      from: '2026-01-01',
      to: '2026-06-30',
      customerEmail: 'jane@example.com',
      affiliateId: 42,
      productId: 7,
      partnerId: 11,
    })
  })

  it('drops invalid fields independently without rejecting the bag', () => {
    // status is invalid → drops; rest is preserved.
    expect(
      parseOrderFilters({
        status: 'wat',
        from: '2026-01-01',
        customerEmail: 'jane@x.com',
      }),
    ).toEqual({
      ...EMPTY,
      from: '2026-01-01',
      customerEmail: 'jane@x.com',
    })
  })
})

describe('orderFiltersToRpcPayload', () => {
  it('returns an empty object for an empty filter bag', () => {
    expect(orderFiltersToRpcPayload(EMPTY)).toEqual({})
  })

  it('omits null fields (so the RPC gets no key, not null)', () => {
    expect(
      orderFiltersToRpcPayload({
        ...EMPTY,
        status: 'paid',
        customerEmail: 'jane@x.com',
      }),
    ).toEqual({
      status: 'paid',
      customerEmail: 'jane@x.com',
    })
  })

  it('keeps 0-id filters as the actual integer (defensive — 0 is rejected in parser, but payload should not invent 0)', () => {
    expect(
      orderFiltersToRpcPayload({
        ...EMPTY,
        affiliateId: 5,
      }),
    ).toEqual({ affiliateId: 5 })
  })
})

describe('ORDER_STATUS_LABEL', () => {
  it('has a human-readable label for every order_status enum value', () => {
    for (const s of [
      'pending',
      'awaiting_payment',
      'paid',
      'fulfilled',
      'refunded',
      'partially_refunded',
      'failed',
      'canceled',
      'fraudulent',
    ]) {
      expect(ORDER_STATUS_LABEL[s as keyof typeof ORDER_STATUS_LABEL]).toBeTruthy()
    }
  })
})
