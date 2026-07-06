// types.test.ts — pure-function tests for the admin refunds types +
// filter parser + label maps + SLA helpers.
//
// Per cron protocol §"Done": unit tests for every action / guard /
// formatter. The types module is the canonical source of truth for
// the filter URL shape + the spec/DB vocabulary mapping, so its
// helpers get the most thorough coverage.

import { describe, it, expect } from 'vitest'
import {
  REFUND_FILTER_STATUSES,
  REFUND_STATUS_LABEL,
  REFUND_STATUS_KIND,
  REFUND_REASON_LABEL,
  REFUND_DEFAULT_STATUS,
  REFUND_SLA_SECONDS,
  EMPTY_REFUND_STATS,
  refundFiltersToRpcPayload,
  parseRefundFilters,
  parseRefundId,
  isRefundOverdue,
  formatRefundAge,
  RefundFiltersSchema,
  type ParsedRefundFilters,
} from './types'

describe('REFUND_FILTER_STATUSES', () => {
  it('contains exactly the 5 refund_status enum values (post-0059)', () => {
    expect(REFUND_FILTER_STATUSES).toEqual([
      'pending',
      'approved',
      'succeeded',
      'failed',
      'canceled',
    ])
  })
})

describe('REFUND_STATUS_LABEL', () => {
  it('maps DB pending → spec Requested (the spec/DB vocabulary mapping)', () => {
    expect(REFUND_STATUS_LABEL.pending).toBe('Requested')
  })
  it('maps DB approved → spec Approved', () => {
    expect(REFUND_STATUS_LABEL.approved).toBe('Approved')
  })
  it('maps DB succeeded → spec Processed', () => {
    expect(REFUND_STATUS_LABEL.succeeded).toBe('Processed')
  })
  it('maps DB failed → spec Rejected', () => {
    expect(REFUND_STATUS_LABEL.failed).toBe('Rejected')
  })
  it('maps DB canceled → Canceled (legacy)', () => {
    expect(REFUND_STATUS_LABEL.canceled).toBe('Canceled')
  })
})

describe('REFUND_STATUS_KIND', () => {
  it('uses amber for pending (awaiting admin decision)', () => {
    expect(REFUND_STATUS_KIND.pending).toBe('amber')
  })
  it('uses blue for approved (committed, awaiting webhook)', () => {
    expect(REFUND_STATUS_KIND.approved).toBe('blue')
  })
  it('uses green for succeeded (refund completed)', () => {
    expect(REFUND_STATUS_KIND.succeeded).toBe('green')
  })
  it('uses red for failed (admin denied / Stripe failed)', () => {
    expect(REFUND_STATUS_KIND.failed).toBe('red')
  })
  it('uses gray for canceled (legacy)', () => {
    expect(REFUND_STATUS_KIND.canceled).toBe('gray')
  })
})

describe('REFUND_REASON_LABEL', () => {
  it('covers all 6 enum values', () => {
    expect(REFUND_REASON_LABEL.duplicate).toBe('Duplicate charge')
    expect(REFUND_REASON_LABEL.fraudulent).toBe('Fraudulent')
    expect(REFUND_REASON_LABEL.requested_by_customer).toBe('Customer request')
    expect(REFUND_REASON_LABEL.product_not_received).toBe('Product not received')
    expect(REFUND_REASON_LABEL.product_unacceptable).toBe('Product unacceptable')
    expect(REFUND_REASON_LABEL.other).toBe('Other')
  })
})

describe('REFUND_DEFAULT_STATUS', () => {
  it('is "pending" — spec line 65: "Default filter is `status=`requested`" (DB pending ↔ spec requested)', () => {
    expect(REFUND_DEFAULT_STATUS).toBe('pending')
  })
})

describe('REFUND_SLA_SECONDS', () => {
  it('is 24 * 60 * 60 (24h wall-clock per spec line 64)', () => {
    expect(REFUND_SLA_SECONDS).toBe(86400)
  })
})

describe('EMPTY_REFUND_STATS', () => {
  it('zeroes every bucket', () => {
    expect(EMPTY_REFUND_STATS).toEqual({
      total: 0,
      pending: 0,
      approved: 0,
      succeeded: 0,
      failed: 0,
      canceled: 0,
    })
  })
})

describe('parseRefundFilters', () => {
  it('returns nulls when search params are missing', () => {
    const parsed = parseRefundFilters(null)
    expect(parsed).toEqual({
      status: null,
      from: null,
      to: null,
      customerEmail: null,
      productId: null,
    })
  })

  it('returns nulls when search params is undefined', () => {
    const parsed = parseRefundFilters(undefined)
    expect(parsed).toEqual({
      status: null,
      from: null,
      to: null,
      customerEmail: null,
      productId: null,
    })
  })

  it('parses a valid status', () => {
    const parsed = parseRefundFilters({ status: 'pending' })
    expect(parsed.status).toBe('pending')
  })

  it('rejects an unknown status', () => {
    const parsed = parseRefundFilters({ status: 'requested' })
    expect(parsed.status).toBeNull()
  })

  it('rejects a status with SQL injection attempt', () => {
    const parsed = parseRefundFilters({ status: "pending'; DROP TABLE refunds; --" })
    expect(parsed.status).toBeNull()
  })

  it('parses a valid YYYY-MM-DD `from`', () => {
    const parsed = parseRefundFilters({ from: '2026-06-30' })
    expect(parsed.from).toBe('2026-06-30')
  })

  it('rejects a malformed `from`', () => {
    expect(parseRefundFilters({ from: '06/30/2026' }).from).toBeNull()
    expect(parseRefundFilters({ from: '2026-13-01' }).from).toBeNull()
    expect(parseRefundFilters({ from: '2026-02-30' }).from).toBeNull()
    expect(parseRefundFilters({ from: 'not-a-date' }).from).toBeNull()
  })

  it('parses a valid YYYY-MM-DD `to`', () => {
    const parsed = parseRefundFilters({ to: '2026-06-30' })
    expect(parsed.to).toBe('2026-06-30')
  })

  it('rejects a malformed `to`', () => {
    expect(parseRefundFilters({ to: 'tomorrow' }).to).toBeNull()
  })

  it('trims and slices customerEmail to 100 chars', () => {
    const longEmail = 'a'.repeat(150) + '@example.com'
    const parsed = parseRefundFilters({ customerEmail: '  ' + longEmail + '  ' })
    expect(parsed.customerEmail).toBe('a'.repeat(100))
  })

  it('drops empty customerEmail', () => {
    const parsed = parseRefundFilters({ customerEmail: '   ' })
    expect(parsed.customerEmail).toBeNull()
  })

  it('parses a valid positive productId', () => {
    const parsed = parseRefundFilters({ productId: '12345' })
    expect(parsed.productId).toBe(12345)
  })

  it('rejects a zero / negative productId', () => {
    expect(parseRefundFilters({ productId: '0' }).productId).toBeNull()
    expect(parseRefundFilters({ productId: '-5' }).productId).toBeNull()
  })

  it('rejects a non-numeric productId', () => {
    expect(parseRefundFilters({ productId: 'abc' }).productId).toBeNull()
    expect(parseRefundFilters({ productId: '12.34' }).productId).toBeNull()
    expect(parseRefundFilters({ productId: '12e5' }).productId).toBeNull()
  })

  it('takes the first value when an array is passed (defensive against array-typed searchParams)', () => {
    const parsed = parseRefundFilters({ status: ['pending', 'failed'] })
    expect(parsed.status).toBe('pending')
  })

  it('parses every field independently when given a complete bag', () => {
    const parsed = parseRefundFilters({
      status: 'pending',
      from: '2026-01-01',
      to: '2026-12-31',
      customerEmail: 'k@example.com',
      productId: '99',
    })
    expect(parsed).toEqual({
      status: 'pending',
      from: '2026-01-01',
      to: '2026-12-31',
      customerEmail: 'k@example.com',
      productId: 99,
    })
  })

  it('gracefully degrades — drops individual bad fields without rejecting the whole bag', () => {
    const parsed = parseRefundFilters({
      status: 'pending',
      from: 'bad',
      customerEmail: 'good@example.com',
      productId: 'bad',
    })
    expect(parsed.status).toBe('pending')
    expect(parsed.from).toBeNull()
    expect(parsed.customerEmail).toBe('good@example.com')
    expect(parsed.productId).toBeNull()
  })
})

describe('refundFiltersToRpcPayload', () => {
  it('only includes fields with non-null values', () => {
    const filters: ParsedRefundFilters = {
      status: 'pending',
      from: null,
      to: null,
      customerEmail: null,
      productId: null,
    }
    expect(refundFiltersToRpcPayload(filters)).toEqual({ status: 'pending' })
  })

  it('includes all fields when fully populated', () => {
    const filters: ParsedRefundFilters = {
      status: 'approved',
      from: '2026-06-01',
      to: '2026-06-30',
      customerEmail: 'k@example.com',
      productId: 123,
    }
    expect(refundFiltersToRpcPayload(filters)).toEqual({
      status: 'approved',
      from: '2026-06-01',
      to: '2026-06-30',
      customerEmail: 'k@example.com',
      productId: 123,
    })
  })

  it('returns an empty object when no filters are set', () => {
    expect(
      refundFiltersToRpcPayload({
        status: null,
        from: null,
        to: null,
        customerEmail: null,
        productId: null,
      }),
    ).toEqual({})
  })
})

describe('parseRefundId', () => {
  it('parses a valid positive bigint string', () => {
    expect(parseRefundId('12345')).toBe(12345)
  })

  it('returns null for null / undefined / empty', () => {
    expect(parseRefundId(null)).toBeNull()
    expect(parseRefundId(undefined)).toBeNull()
    expect(parseRefundId('')).toBeNull()
  })

  it('rejects decimal / signed / scientific / hex inputs', () => {
    expect(parseRefundId('123.45')).toBeNull()
    expect(parseRefundId('-5')).toBeNull()
    expect(parseRefundId('+5')).toBeNull()
    expect(parseRefundId('12e5')).toBeNull()
    expect(parseRefundId('0xff')).toBeNull()
    expect(parseRefundId('0x10')).toBeNull()
  })

  it('rejects non-numeric / unicode-digit / CRLF-injected inputs', () => {
    expect(parseRefundId('abc')).toBeNull()
    expect(parseRefundId('١٢٣')).toBeNull() // Arabic-Indic digits
    expect(parseRefundId('12\r\n3')).toBeNull()
  })

  it('rejects zero (refund ids are bigserial positive)', () => {
    expect(parseRefundId('0')).toBeNull()
  })

  it('trims surrounding whitespace before validating', () => {
    expect(parseRefundId('  12345  ')).toBe(12345)
  })
})

describe('isRefundOverdue', () => {
  it('returns true when requested_at > 24h ago', () => {
    const requested = new Date('2026-06-30T00:00:00Z')
    const now = new Date('2026-07-01T01:00:00Z') // 25h later
    expect(isRefundOverdue(requested, now)).toBe(true)
  })

  it('returns false when requested_at is exactly 24h ago (boundary)', () => {
    const requested = new Date('2026-06-30T00:00:00Z')
    const now = new Date('2026-07-01T00:00:00Z') // 24h later
    expect(isRefundOverdue(requested, now)).toBe(false)
  })

  it('returns false when requested_at < 24h ago', () => {
    const requested = new Date('2026-06-30T00:00:00Z')
    const now = new Date('2026-06-30T23:00:00Z') // 23h later
    expect(isRefundOverdue(requested, now)).toBe(false)
  })

  it('accepts an ISO string', () => {
    expect(isRefundOverdue('2026-06-30T00:00:00Z', '2026-07-01T01:00:00Z')).toBe(true)
  })

  it('defaults `now` to the current time', () => {
    const requested = new Date(Date.now() - 25 * 60 * 60 * 1000)
    expect(isRefundOverdue(requested)).toBe(true)
  })

  it('returns false when either input is unparseable', () => {
    expect(isRefundOverdue('not-a-date', new Date())).toBe(false)
    expect(isRefundOverdue(new Date(), 'not-a-date')).toBe(false)
  })

  it('returns false when now is before requested_at (clock skew safety)', () => {
    const requested = new Date('2026-07-01T00:00:00Z')
    const now = new Date('2026-06-30T00:00:00Z')
    expect(isRefundOverdue(requested, now)).toBe(false)
  })
})

describe('formatRefundAge', () => {
  it('renders seconds', () => {
    expect(formatRefundAge(0)).toBe('0s ago')
    expect(formatRefundAge(45)).toBe('45s ago')
  })

  it('renders minutes', () => {
    expect(formatRefundAge(60)).toBe('1m ago')
    expect(formatRefundAge(30 * 60)).toBe('30m ago')
    expect(formatRefundAge(59 * 60 + 30)).toBe('59m ago')
  })

  it('renders hours', () => {
    expect(formatRefundAge(60 * 60)).toBe('1h ago')
    expect(formatRefundAge(23 * 60 * 60)).toBe('23h ago')
  })

  it('renders days', () => {
    expect(formatRefundAge(24 * 60 * 60)).toBe('1d ago')
    expect(formatRefundAge(7 * 24 * 60 * 60)).toBe('7d ago')
  })

  it('returns "—" for negative / NaN / Infinity', () => {
    expect(formatRefundAge(-1)).toBe('—')
    expect(formatRefundAge(NaN)).toBe('—')
    expect(formatRefundAge(Infinity)).toBe('—')
  })
})

describe('RefundFiltersSchema (Zod)', () => {
  it('accepts an empty object', () => {
    const result = RefundFiltersSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('accepts every valid status', () => {
    for (const status of REFUND_FILTER_STATUSES) {
      const result = RefundFiltersSchema.safeParse({ status })
      expect(result.success).toBe(true)
    }
  })

  it('rejects an unknown status', () => {
    const result = RefundFiltersSchema.safeParse({ status: 'requested' })
    expect(result.success).toBe(false)
  })

  it('rejects an unknown extra key (strict mode)', () => {
    const result = RefundFiltersSchema.safeParse({ status: 'pending', extra: 'x' })
    expect(result.success).toBe(false)
  })

  it('coerces a string productId to number', () => {
    const result = RefundFiltersSchema.safeParse({ productId: '12345' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.productId).toBe(12345)
    }
  })

  it('rejects a negative productId', () => {
    const result = RefundFiltersSchema.safeParse({ productId: -5 })
    expect(result.success).toBe(false)
  })
})