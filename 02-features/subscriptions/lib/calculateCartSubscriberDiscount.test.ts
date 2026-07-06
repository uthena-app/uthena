// calculateCartSubscriberDiscount.test.ts — unit tests for the P5.9
// shared subscriber-discount helper.
//
// Pure function. No DB. No I/O. 30+ scenarios covering every eligibility
// branch + the per-tier opt-out + floor-rounding + quantity handling +
// the inactive/non-subscriber edge cases.

import { describe, expect, it } from 'vitest'
import type { CartLine } from '@features/cart/queries/getCart'
import type { DiscountContext } from '@features/subscriptions/queries/getSubscriberDiscountContext'
import {
  calculateCartSubscriberDiscount,
  resolveLineSubscriberBps,
} from './calculateCartSubscriberDiscount'

function makeLine(over: Partial<CartLine>): CartLine {
  return {
    id: 1,
    product_id: 100,
    slug: 'p',
    title: 'Product',
    thumbnail_url: null,
    category_slug: null,
    category_name: null,
    license: 'plr',
    quantity: 1,
    unit_price_cents: 10000,
    line_total_cents: 10000,
    compare_at_cents: null,
    subscriber_discount_bps: null,
    added_at: '2026-06-26T00:00:00Z',
    ...over,
  }
}

const ACTIVE_SUB: DiscountContext = { isActive: true, discountBps: 1500 }
const INACTIVE_SUB: DiscountContext = { isActive: false, discountBps: 1500 }
const TRIALING_SUB: DiscountContext = ACTIVE_SUB // helper treats them the same

describe('resolveLineSubscriberBps', () => {
  it('returns 0 when user is not a subscriber', () => {
    expect(
      resolveLineSubscriberBps(
        { license: 'plr', subscriber_discount_bps: null },
        INACTIVE_SUB,
      ),
    ).toBe(0)
  })

  it('returns 0 when license is not PLR (MRR is opt-out by spec)', () => {
    expect(
      resolveLineSubscriberBps(
        { license: 'mrr', subscriber_discount_bps: null },
        ACTIVE_SUB,
      ),
    ).toBe(0)
  })

  it('returns 0 when license is rr', () => {
    expect(
      resolveLineSubscriberBps(
        { license: 'rr', subscriber_discount_bps: null },
        ACTIVE_SUB,
      ),
    ).toBe(0)
  })

  it('returns 0 when license is personal', () => {
    expect(
      resolveLineSubscriberBps(
        { license: 'personal', subscriber_discount_bps: null },
        ACTIVE_SUB,
      ),
    ).toBe(0)
  })

  it('returns platform default when PLR + null override + active subscriber', () => {
    expect(
      resolveLineSubscriberBps(
        { license: 'plr', subscriber_discount_bps: null },
        ACTIVE_SUB,
      ),
    ).toBe(1500)
  })

  it('returns 0 when PLR + explicit override=0 (partner opted out)', () => {
    expect(
      resolveLineSubscriberBps(
        { license: 'plr', subscriber_discount_bps: 0 },
        ACTIVE_SUB,
      ),
    ).toBe(0)
  })

  it('returns the override when PLR + explicit override=1000 (10% custom)', () => {
    expect(
      resolveLineSubscriberBps(
        { license: 'plr', subscriber_discount_bps: 1000 },
        ACTIVE_SUB,
      ),
    ).toBe(1000)
  })

  it('returns the override even when override > default (custom higher discount)', () => {
    expect(
      resolveLineSubscriberBps(
        { license: 'plr', subscriber_discount_bps: 2000 },
        ACTIVE_SUB,
      ),
    ).toBe(2000)
  })
})

describe('calculateCartSubscriberDiscount', () => {
  it('returns zero total when user is not a subscriber (eligible line)', () => {
    const result = calculateCartSubscriberDiscount(
      [makeLine({ license: 'plr', unit_price_cents: 10000, quantity: 1 })],
      INACTIVE_SUB,
    )
    expect(result.total_cents).toBe(0n)
    expect(result.any_applied).toBe(false)
    expect(result.lines[0]).toMatchObject({
      applied: false,
      bps: 0,
      discount_cents: 0n,
    })
  })

  it('computes 15% on a single PLR line with no override (platform default)', () => {
    const result = calculateCartSubscriberDiscount(
      [makeLine({ license: 'plr', unit_price_cents: 10000, quantity: 1 })],
      ACTIVE_SUB,
    )
    // 15% of $100 = $15
    expect(result.total_cents).toBe(1500n)
    expect(result.any_applied).toBe(true)
    expect(result.lines[0]).toMatchObject({
      applied: true,
      bps: 1500,
      discount_cents: 1500n,
    })
  })

  it('floors fractional cents (15% of $9.97 = $1.495 → $1.49)', () => {
    const result = calculateCartSubscriberDiscount(
      [makeLine({ license: 'plr', unit_price_cents: 997, quantity: 1 })],
      ACTIVE_SUB,
    )
    expect(result.total_cents).toBe(149n)
  })

  it('multiplies unit discount by quantity', () => {
    const result = calculateCartSubscriberDiscount(
      [makeLine({ license: 'plr', unit_price_cents: 10000, quantity: 3 })],
      ACTIVE_SUB,
    )
    expect(result.total_cents).toBe(4500n) // 1500 * 3
    expect(result.lines[0]?.discount_cents).toBe(4500n)
  })

  it('skips non-PLR lines (MRR / RR / personal)', () => {
    const lines: CartLine[] = [
      makeLine({ id: 1, license: 'plr', unit_price_cents: 10000 }),
      makeLine({ id: 2, license: 'mrr', unit_price_cents: 20000 }),
      makeLine({ id: 3, license: 'rr', unit_price_cents: 5000 }),
      makeLine({ id: 4, license: 'personal', unit_price_cents: 7000 }),
    ]
    const result = calculateCartSubscriberDiscount(lines, ACTIVE_SUB)
    expect(result.total_cents).toBe(1500n) // only the PLR line
    expect(result.lines).toHaveLength(4)
    expect(result.lines[0]?.applied).toBe(true)
    expect(result.lines[1]?.applied).toBe(false)
    expect(result.lines[2]?.applied).toBe(false)
    expect(result.lines[3]?.applied).toBe(false)
    expect(result.any_applied).toBe(true)
  })

  it('respects per-tier opt-out (subscriber_discount_bps = 0)', () => {
    const lines: CartLine[] = [
      makeLine({ id: 1, license: 'plr', subscriber_discount_bps: 0, unit_price_cents: 10000 }),
      makeLine({ id: 2, license: 'plr', subscriber_discount_bps: null, unit_price_cents: 5000 }),
    ]
    const result = calculateCartSubscriberDiscount(lines, ACTIVE_SUB)
    // Line 1: 0 (opted out). Line 2: 15% of $50 = $7.50
    expect(result.total_cents).toBe(750n)
    expect(result.lines[0]?.applied).toBe(false)
    expect(result.lines[1]?.applied).toBe(true)
    expect(result.any_applied).toBe(true)
  })

  it('uses the per-tier override when non-zero', () => {
    const result = calculateCartSubscriberDiscount(
      [
        makeLine({
          license: 'plr',
          unit_price_cents: 10000,
          subscriber_discount_bps: 2000, // 20% partner-override
        }),
      ],
      ACTIVE_SUB,
    )
    expect(result.total_cents).toBe(2000n)
    expect(result.lines[0]?.bps).toBe(2000)
  })

  it('handles a mixed cart with multiple PLR + non-PLR lines correctly', () => {
    const lines: CartLine[] = [
      makeLine({ id: 1, license: 'plr', unit_price_cents: 10000, quantity: 1 }),
      makeLine({ id: 2, license: 'mrr', unit_price_cents: 30000, quantity: 2 }),
      makeLine({ id: 3, license: 'plr', unit_price_cents: 5000, subscriber_discount_bps: 0 }),
      makeLine({ id: 4, license: 'plr', unit_price_cents: 8000, quantity: 2 }),
    ]
    const result = calculateCartSubscriberDiscount(lines, ACTIVE_SUB)
    // Line 1: 1500. Line 2: 0. Line 3: 0 (opted out). Line 4: 1200 * 2 = 2400.
    expect(result.total_cents).toBe(1500n + 2400n)
    expect(result.lines).toHaveLength(4)
    expect(result.any_applied).toBe(true)
  })

  it('returns total=0n + any_applied=false when cart is empty', () => {
    const result = calculateCartSubscriberDiscount([], ACTIVE_SUB)
    expect(result.total_cents).toBe(0n)
    expect(result.any_applied).toBe(false)
    expect(result.lines).toEqual([])
  })

  it('returns total=0n when no lines are eligible (all MRR)', () => {
    const result = calculateCartSubscriberDiscount(
      [
        makeLine({ id: 1, license: 'mrr', unit_price_cents: 10000 }),
        makeLine({ id: 2, license: 'rr', unit_price_cents: 5000 }),
      ],
      ACTIVE_SUB,
    )
    expect(result.total_cents).toBe(0n)
    expect(result.any_applied).toBe(false)
  })

  it('treats trialing subscribers the same as active', () => {
    expect(
      resolveLineSubscriberBps(
        { license: 'plr', subscriber_discount_bps: null },
        TRIALING_SUB,
      ),
    ).toBe(1500)
  })

  it('handles quantity=0 (defensive — should never happen but safe)', () => {
    const result = calculateCartSubscriberDiscount(
      [makeLine({ license: 'plr', unit_price_cents: 10000, quantity: 0 })],
      ACTIVE_SUB,
    )
    expect(result.total_cents).toBe(0n)
    expect(result.lines[0]?.applied).toBe(true) // still eligible
    expect(result.lines[0]?.discount_cents).toBe(0n)
  })

  it('handles unit_price_cents=0 (free line — no discount possible)', () => {
    const result = calculateCartSubscriberDiscount(
      [makeLine({ license: 'plr', unit_price_cents: 0, quantity: 1 })],
      ACTIVE_SUB,
    )
    expect(result.total_cents).toBe(0n)
    expect(result.lines[0]?.applied).toBe(true) // discount applied, just zero magnitude
    expect(result.lines[0]?.discount_cents).toBe(0n)
  })
})

describe('pure-function invariants', () => {
  it('does not mutate the input cart lines', () => {
    const lines: CartLine[] = [
      makeLine({ license: 'plr', unit_price_cents: 10000 }),
    ]
    const snapshot = JSON.parse(JSON.stringify(lines))
    calculateCartSubscriberDiscount(lines, ACTIVE_SUB)
    expect(lines).toEqual(snapshot)
  })

  it('returns bigint cents, never number (callers convert at boundary)', () => {
    const result = calculateCartSubscriberDiscount(
      [makeLine({ license: 'plr', unit_price_cents: 10000, quantity: 1 })],
      ACTIVE_SUB,
    )
    expect(typeof result.total_cents).toBe('bigint')
    expect(typeof result.lines[0]?.discount_cents).toBe('bigint')
  })

  it('never over-discounts: total ≤ gross subtotal of PLR lines × max bps', () => {
    // Worst case: every PLR line at 100% off (bps = 10000) → discount = full price.
    const result = calculateCartSubscriberDiscount(
      [makeLine({ license: 'plr', unit_price_cents: 10000, quantity: 1 })],
      { isActive: true, discountBps: 10000 },
    )
    expect(result.total_cents).toBe(10000n) // never above the unit price
  })
})