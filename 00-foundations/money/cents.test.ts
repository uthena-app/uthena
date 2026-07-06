// Unit tests for the money helpers in `cents.ts`. Pure functions, no
// fixtures needed. Covers every helper + every edge case that matters
// for cents-safe bigint math.
//
// Run: `pnpm test cents` (vitest).

import { describe, expect, it } from 'vitest'
import {
  addMoney,
  applyBps,
  applyDiscountBps,
  assertCents,
  calculateRefundRoyalty,
  calculateRoyalty,
  calculateSubscriberDiscount,
  discountFromBps,
  formatMoney,
  formatMoneyShort,
  multiplyCents,
  parsePriceToCents,
  subtractMoney,
} from './cents'

// ===========================================================================
// addMoney
// ===========================================================================

describe('addMoney', () => {
  it('adds two bigints', () => {
    expect(addMoney(49700n, 100n)).toBe(49800n)
  })
  it('adds two numbers', () => {
    expect(addMoney(49700, 100)).toBe(49800n)
  })
  it('adds mixed types (bigint + number)', () => {
    expect(addMoney(49700n, 100)).toBe(49800n)
    expect(addMoney(49700, 100n)).toBe(49800n)
  })
  it('adds 0 + n', () => {
    expect(addMoney(0n, 100n)).toBe(100n)
    expect(addMoney(0, 100)).toBe(100n)
  })
  it('adds n + 0', () => {
    expect(addMoney(100n, 0n)).toBe(100n)
  })
  it('adds 0 + 0 = 0', () => {
    expect(addMoney(0n, 0n)).toBe(0n)
  })
  it('allows negative inputs (for debit modeling)', () => {
    expect(addMoney(100n, -50n)).toBe(50n)
    expect(addMoney(0n, -100n)).toBe(-100n)
  })
  it('truncates non-integer number inputs', () => {
    // 49700.7 → 49700 (Math.trunc); 49700 + 100 = 49800
    expect(addMoney(49700.7, 100)).toBe(49800n)
    expect(addMoney(49700.9, 100)).toBe(49800n)
  })
  it('handles very large values without precision loss (bigint-native)', () => {
    // 2^53 is the safe-integer ceiling for `number`. Anything bigger
    // would silently lose precision if we used `number` math — bigint
    // keeps it exact.
    const big = 2n ** 60n // ~1.15e18 — well above 2^53
    expect(addMoney(big, 1n)).toBe(big + 1n)
  })
})

// ===========================================================================
// subtractMoney
// ===========================================================================

describe('subtractMoney', () => {
  it('subtracts normally', () => {
    expect(subtractMoney(49700n, 100n)).toBe(49600n)
  })
  it('subtracts across types', () => {
    expect(subtractMoney(49700, 100n)).toBe(49600n)
    expect(subtractMoney(49700n, 100)).toBe(49600n)
  })
  it('clamps at 0n when the result would be negative', () => {
    expect(subtractMoney(50n, 100n)).toBe(0n)
    expect(subtractMoney(0n, 1n)).toBe(0n)
    expect(subtractMoney(1n, 1n)).toBe(0n)
  })
  it('does not throw on clamp (silent safety)', () => {
    expect(() => subtractMoney(0n, 999_999n)).not.toThrow()
  })
  it('subtracts 0', () => {
    expect(subtractMoney(49700n, 0n)).toBe(49700n)
    expect(subtractMoney(49700n, 0)).toBe(49700n)
  })
  it('0 - 0 = 0', () => {
    expect(subtractMoney(0n, 0n)).toBe(0n)
  })
  it('preserves bigint precision at extreme values', () => {
    const big = 2n ** 60n
    expect(subtractMoney(big, 1n)).toBe(big - 1n)
  })
})

// ===========================================================================
// multiplyCents
// ===========================================================================

describe('multiplyCents', () => {
  it('multiplies by a positive integer', () => {
    expect(multiplyCents(49700n, 3)).toBe(149100n)
  })
  it('multiplies by 0 = 0', () => {
    expect(multiplyCents(49700n, 0)).toBe(0n)
    expect(multiplyCents(0n, 3)).toBe(0n)
  })
  it('multiplies by 1 = n', () => {
    expect(multiplyCents(49700n, 1)).toBe(49700n)
  })
  it('accepts mixed input types', () => {
    expect(multiplyCents(49700, 3)).toBe(149100n)
    expect(multiplyCents(49700n, 3)).toBe(149100n)
  })
  it('throws on negative factor', () => {
    expect(() => multiplyCents(100n, -1)).toThrow(RangeError)
  })
  it('throws on non-integer factor (truncates first)', () => {
    // Math.trunc(3.5) = 3
    expect(multiplyCents(100n, 3.5)).toBe(300n)
    expect(multiplyCents(100n, 3.9)).toBe(300n)
  })
  it('throws on non-finite factor', () => {
    expect(() => multiplyCents(100n, NaN)).toThrow(RangeError)
    expect(() => multiplyCents(100n, Infinity)).toThrow(RangeError)
  })
  it('throws on factor above 10M sanity cap', () => {
    expect(() => multiplyCents(100n, 10_000_001)).toThrow(RangeError)
  })
})

// ===========================================================================
// applyDiscountBps / discountFromBps
// ===========================================================================

describe('applyDiscountBps', () => {
  it('applies a 15% discount to $497', () => {
    // 49700 * 1500 / 10000 = 7455 (exact)
    expect(applyDiscountBps(49700n, 1500)).toBe(7455n)
  })
  it('applies a 100% discount (full off)', () => {
    expect(applyDiscountBps(10000n, 10000)).toBe(10000n)
  })
  it('applies a 0% discount (no off)', () => {
    expect(applyDiscountBps(10000n, 0)).toBe(0n)
  })
  it('floors fractional results (we never over-discount)', () => {
    // 333 * 1500 / 10000 = 49.95 → floor → 49
    expect(applyDiscountBps(333n, 1500)).toBe(49n)
    // 100 * 333 / 10000 = 3.33 → floor → 3
    expect(applyDiscountBps(100n, 333)).toBe(3n)
  })
  it('returns 0 for 0 cents', () => {
    expect(applyDiscountBps(0n, 1500)).toBe(0n)
    expect(applyDiscountBps(0n, 10000)).toBe(0n)
  })
  it('accepts mixed input types', () => {
    expect(applyDiscountBps(49700, 1500)).toBe(7455n)
    expect(applyDiscountBps(49700n, 1500)).toBe(7455n)
  })
  it('throws on bps out of range', () => {
    expect(() => applyDiscountBps(100n, -1)).toThrow(RangeError)
    expect(() => applyDiscountBps(100n, 10001)).toThrow(RangeError)
  })
  it('throws on non-finite bps', () => {
    expect(() => applyDiscountBps(100n, NaN)).toThrow(RangeError)
    expect(() => applyDiscountBps(100n, Infinity)).toThrow(RangeError)
  })
})

describe('discountFromBps', () => {
  it('is an alias for applyDiscountBps', () => {
    expect(discountFromBps(49700n, 1500)).toBe(7455n)
    expect(discountFromBps(49700n, 1500)).toBe(applyDiscountBps(49700n, 1500))
  })
})

// ===========================================================================
// calculateRoyalty
// ===========================================================================

describe('calculateRoyalty', () => {
  it('computes 15% of $100 line total', () => {
    // 10000 * 1500 / 10000 = 1500
    expect(calculateRoyalty(10000n, 1500)).toBe(1500n)
  })
  it('floors fractional royalties (never over-pay partner)', () => {
    // 333 * 1500 / 10000 = 49.95 → floor → 49
    expect(calculateRoyalty(333n, 1500)).toBe(49n)
    // 99 * 5000 / 10000 = 49.5 → floor → 49
    expect(calculateRoyalty(99n, 5000)).toBe(49n)
  })
  it('returns 0 for 0 bps', () => {
    expect(calculateRoyalty(10000n, 0)).toBe(0n)
  })
  it('returns 0 for 0 line total', () => {
    expect(calculateRoyalty(0n, 1500)).toBe(0n)
  })
  it('computes 100% royalty', () => {
    expect(calculateRoyalty(10000n, 10000)).toBe(10000n)
  })
  it('accepts mixed input types', () => {
    expect(calculateRoyalty(10000, 1500)).toBe(1500n)
    expect(calculateRoyalty(10000n, 1500)).toBe(1500n)
  })
})

// ===========================================================================
// calculateRefundRoyalty
// ===========================================================================

describe('calculateRefundRoyalty', () => {
  it('returns the full royalty for a full refund (100%)', () => {
    // $100 order, 30% royalty = $30. Full refund → return full $30.
    expect(calculateRefundRoyalty(3000n, 10000n, 10000n)).toBe(3000n)
  })
  it('returns half the royalty for a 50% refund', () => {
    // $100 order, 30% royalty = $30. 50% refund → return $15.
    expect(calculateRefundRoyalty(3000n, 10000n, 5000n)).toBe(1500n)
  })
  it('returns a quarter of the royalty for a 25% refund', () => {
    // $100 order, 30% royalty = $30. 25% refund → return $7.50 → floor $7.
    expect(calculateRefundRoyalty(3000n, 10000n, 2500n)).toBe(750n)
  })
  it('floors fractional results (never gives back more than was earned)', () => {
    // $3.33 sale at 50% royalty = $1.66 royalty (floor of $1.665).
    // 33% refund of $3.33 = $1.10.
    // proportion = 110/333 = 33.03% = 3303 bps.
    // refund royalty = floor($1.66 × 0.3303) = floor($0.548) = $0.54 = 54n.
    expect(calculateRefundRoyalty(166n, 333n, 110n)).toBe(54n)
  })
  it('returns 0 when the proportion is below 1 cent (extreme floor)', () => {
    // $100 order at 1% royalty = $1 royalty.
    // 1-cent refund → proportion = 1/10000 = 1 bps.
    // refund royalty = floor($1 × 0.0001) = floor($0.0001) = $0.
    expect(calculateRefundRoyalty(100n, 10000n, 1n)).toBe(0n)
  })
  it('returns 0 for a zero-royalty sale (no royalty to refund)', () => {
    // 0% royalty → no royalty ever credited → no royalty to claw back.
    expect(calculateRefundRoyalty(0n, 10000n, 5000n)).toBe(0n)
  })
  it('returns 0 for a zero-order-total (defensive — never happens)', () => {
    expect(calculateRefundRoyalty(3000n, 0n, 5000n)).toBe(0n)
  })
  it('returns 0 for a zero refund (nothing to claw back)', () => {
    expect(calculateRefundRoyalty(3000n, 10000n, 0n)).toBe(0n)
  })
  it('clamps at full-sale-royalty when refund > order total (defensive)', () => {
    // Stripe doesn't allow this, but if a future surface ever does,
    // we never claw back more than we paid.
    // 20000 cents refund on a 10000 cents order → clamped to 10000
    // → full royalty = 3000, not 6000.
    expect(calculateRefundRoyalty(3000n, 10000n, 20000n)).toBe(3000n)
  })
  it('handles bigint and number inputs interchangeably', () => {
    expect(calculateRefundRoyalty(3000n, 10000n, 5000n)).toBe(1500n)
    expect(calculateRefundRoyalty(3000, 10000, 5000)).toBe(1500n)
    expect(calculateRefundRoyalty(3000n, 10000, 5000n)).toBe(1500n)
  })
  it('proportional across different royalty rates', () => {
    // 50% royalty partner: $100 order → $50 royalty.
    // 50% refund → return $25 royalty.
    expect(calculateRefundRoyalty(5000n, 10000n, 5000n)).toBe(2500n)
    // 10% royalty partner: $100 order → $10 royalty.
    // 20% refund → return $2 royalty.
    expect(calculateRefundRoyalty(1000n, 10000n, 2000n)).toBe(200n)
  })
  it('matches the sale royalty for an exact 100% refund (no over-claw-back)', () => {
    // Order $497 at 30% royalty = $149 (floor of $149.10).
    // Full refund → return $149, NOT $150.
    expect(calculateRefundRoyalty(149n, 49700n, 49700n)).toBe(149n)
  })
})

// ===========================================================================
// calculateSubscriberDiscount
// ===========================================================================

describe('calculateSubscriberDiscount', () => {
  it('computes 15% off a $100 PLR unit price', () => {
    expect(calculateSubscriberDiscount(10000n, 1500)).toBe(1500n)
  })
  it('returns 0 when discountBps is 0 (non-subscriber)', () => {
    expect(calculateSubscriberDiscount(10000n, 0)).toBe(0n)
  })
  it('floors fractional results', () => {
    // 333 * 1500 / 10000 = 49.95 → 49
    expect(calculateSubscriberDiscount(333n, 1500)).toBe(49n)
  })
  it('accepts mixed input types', () => {
    expect(calculateSubscriberDiscount(10000, 1500)).toBe(1500n)
    expect(calculateSubscriberDiscount(10000n, 1500)).toBe(1500n)
  })
  it('combined with subtractMoney gives post-discount price', () => {
    // 10000 - applyDiscountBps(10000, 1500) = 10000 - 1500 = 8500
    const post = subtractMoney(10000n, calculateSubscriberDiscount(10000n, 1500))
    expect(post).toBe(8500n)
  })
})

// ===========================================================================
// applyBps (legacy round semantics — preserved for backward compat)
// ===========================================================================

describe('applyBps (legacy round)', () => {
  it('rounds half-up', () => {
    // 333 * 8500 / 10000 = 283.05 → round → 283
    expect(applyBps(333n, 8500)).toBe(283n)
    // 100 * 333 / 10000 = 3.33 → round → 3
    expect(applyBps(100n, 333)).toBe(3n)
  })
  it('rounds half up on .5 boundary', () => {
    // 100 * 50 / 10000 = 0.5 → round half up → 1
    expect(applyBps(100n, 50)).toBe(1n)
    // 200 * 50 / 10000 = 1.0 → 1
    expect(applyBps(200n, 50)).toBe(1n)
  })
  it('returns 0 for 0 bps', () => {
    expect(applyBps(10000n, 0)).toBe(0n)
  })
  it('returns 0 for 0 cents', () => {
    expect(applyBps(0n, 1500)).toBe(0n)
  })
  it('throws on bps out of range', () => {
    expect(() => applyBps(100n, -1)).toThrow(RangeError)
    expect(() => applyBps(100n, 10001)).toThrow(RangeError)
  })
})

// ===========================================================================
// formatMoney / formatMoneyShort
// ===========================================================================

describe('formatMoney', () => {
  it.each([
    [0n, '$0.00'],
    [1n, '$0.01'],
    [99n, '$0.99'],
    [100n, '$1.00'],
    [49700n, '$497.00'],
    [100000n, '$1,000.00'],
    [1234567n, '$12,345.67'],
  ])('formats %s as %s', (input, expected) => {
    expect(formatMoney(input)).toBe(expected)
  })
  it('accepts number input (legacy callers)', () => {
    expect(formatMoney(49700)).toBe('$497.00')
    expect(formatMoney(0)).toBe('$0.00')
  })
  it('supports EUR', () => {
    expect(formatMoney(49700n, 'EUR')).toMatch(/497\.00/)
  })
  it('supports GBP', () => {
    expect(formatMoney(49700n, 'GBP')).toMatch(/497\.00/)
  })
  it('handles very large cents values without overflow', () => {
    // 2^53 - 1 cents = ~$90 trillion (still within safe integer)
    const safe = BigInt(Number.MAX_SAFE_INTEGER)
    const result = formatMoney(safe)
    expect(result).toContain('90')
  })
})

describe('formatMoneyShort', () => {
  it.each([
    [0n, '$0'],
    [100n, '$1'],
    [49700n, '$497'],
    [199n, '$2'],
    [100000n, '$1,000'],
  ])('formats %s as %s', (input, expected) => {
    expect(formatMoneyShort(input)).toBe(expected)
  })
  it('accepts number input', () => {
    expect(formatMoneyShort(49700)).toBe('$497')
  })
  it('rounds half-even for display only', () => {
    // $1.995 → $2 (rounding at the dollar boundary for display)
    expect(formatMoneyShort(199n)).toBe('$2')
  })
})

// ===========================================================================
// parsePriceToCents
// ===========================================================================

describe('parsePriceToCents', () => {
  it.each([
    ['19.99', 1999],
    ['0', 0],
    ['0.00', 0],
    ['100', 10000],
    ['  49.99  ', 4999],
    ['1,99', 199], // comma-as-decimal-separator
    ['$49.99', 4999], // strips non-digit chars
    ['€100.00', 10000],
  ])('parses %s as %i cents', (input, expected) => {
    expect(parsePriceToCents(input)).toBe(expected)
  })
  it('returns 0 for non-numeric input', () => {
    expect(parsePriceToCents('')).toBe(0)
    expect(parsePriceToCents('abc')).toBe(0)
    expect(parsePriceToCents('NaN')).toBe(0)
  })
  it('handles negatives', () => {
    expect(parsePriceToCents('-19.99')).toBe(-1999)
  })
})

// ===========================================================================
// assertCents
// ===========================================================================

describe('assertCents', () => {
  it('returns the value as bigint for non-negative integers', () => {
    expect(assertCents(0)).toBe(0n)
    expect(assertCents(49700)).toBe(49700n)
    expect(assertCents(49700n)).toBe(49700n)
  })
  it('throws on negative', () => {
    expect(() => assertCents(-1)).toThrow(RangeError)
    expect(() => assertCents(-1n)).toThrow(RangeError)
  })
  it('throws on non-integer (after Math.trunc the type is integer)', () => {
    // Note: assertCents calls toBigInt which uses Math.trunc on number.
    // So 49700.5 → 49700n (no throw). Non-finite throws.
    expect(() => assertCents(NaN)).toThrow()
    expect(() => assertCents(Infinity)).toThrow()
  })
  it('includes the label in the error message', () => {
    expect(() => assertCents(-1, 'price')).toThrow(/price/)
    expect(() => assertCents(-1)).toThrow(/cents/)
  })
  it('default label is "cents"', () => {
    expect(() => assertCents(-1)).toThrow(/cents/)
  })
})

// ===========================================================================
// Integration — checkout math flows
// ===========================================================================

describe('integration: checkout math', () => {
  it('computes a 15%-discounted PLR line item', () => {
    const unitPrice = 10000n // $100
    const discountBps = 1500 // 15%
    const quantity = 3

    const unitDiscount = calculateSubscriberDiscount(unitPrice, discountBps) // 1500n
    const unitAfter = subtractMoney(unitPrice, unitDiscount) // 8500n
    const lineTotal = multiplyCents(unitAfter, quantity) // 25500n
    const lineDiscount = multiplyCents(unitDiscount, quantity) // 4500n
    const royalty = calculateRoyalty(lineTotal, 1500) // 3825n (15% of 25500)

    expect(unitDiscount).toBe(1500n)
    expect(unitAfter).toBe(8500n)
    expect(lineTotal).toBe(25500n)
    expect(lineDiscount).toBe(4500n)
    expect(royalty).toBe(3825n)
  })
  it('floors royalty correctly at the cent boundary', () => {
    // $3.33 × 15% → 49.95 cents → floor → 49 cents
    const royalty = calculateRoyalty(333n, 1500)
    expect(royalty).toBe(49n)
  })
  it('preserves bigint precision across many operations', () => {
    // Sequential chain: never lose precision even at extreme values.
    let total: bigint = 0n
    for (let i = 0; i < 1000; i++) {
      const line = 100_000_000n // $1M line (cents)
      const discount = applyDiscountBps(line, 1500)
      const after = subtractMoney(line, discount)
      total = addMoney(total, multiplyCents(after, 10))
    }
    // Each line: 100_000_000 * 0.85 * 10 = 850_000_000 cents = $8.5M
    // 1000 lines → 850_000_000_000 cents = $8.5B
    expect(total).toBe(850_000_000_000n)
  })
})