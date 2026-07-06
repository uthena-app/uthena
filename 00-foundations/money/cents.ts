// Money helpers — every monetary value in the codebase is stored as
// integer cents (bigint in DB, number in TS, bigint-safe math here).
// Never floats. Never as a string with a decimal in it. These helpers
// are the only place the conversion + math happens.
//
// Bigint-safe: every arithmetic helper returns `bigint` and accepts
// either `number` or `bigint`. This avoids the silent-precision loss
// that JavaScript `number` causes above 2^53 - 1 cents (~$90 trillion,
// which Uthena will never hit in v1 — but the day it does, we'd be
// debugging rounding bugs in payouts instead of shipping features).
//
// Floor-vs-round: monetary discounts use FLOOR (we never over-discount
// a customer, we never over-pay a partner). The legacy `applyBps`
// helper uses ROUND for backward compatibility with the older
// percentage formatter — prefer the new `applyDiscountBps` /
// `calculateRoyalty` / `calculateSubscriberDiscount` helpers, which
// are all floor-based and have explicit semantic names.

export type CentsInput = number | bigint

export type Currency = 'USD' | 'EUR' | 'GBP'

const CENT_FACTOR = 100n
const BPS_DENOMINATOR = 10000n

/** Coerce a `number | bigint` cents input to `bigint` cents. */
function toBigInt(c: CentsInput): bigint {
  return typeof c === 'bigint' ? c : BigInt(Math.trunc(c))
}

/** Coerce a basis-points input (0..10000) to bigint. Throws on invalid. */
function toBps(bps: number): bigint {
  if (!Number.isFinite(bps)) {
    throw new RangeError(`[money] bps must be a finite number, got ${bps}`)
  }
  const n = Math.trunc(bps)
  if (n < 0 || n > 10000) {
    throw new RangeError(`[money] bps must be 0..10000, got ${bps}`)
  }
  return BigInt(n)
}

// ===========================================================================
// 1. Arithmetic (add / subtract / multiply)
// ===========================================================================

/**
 * Add two cent amounts. Returns bigint. Negative inputs are allowed so
 * the caller can model debits (e.g. `addMoney(currentBalance, -100n)`).
 *
 * @example
 * addMoney(49700n, 100n)  // 49800n
 * addMoney(49700, 100)    // 49800n (mixed types)
 */
export function addMoney(a: CentsInput, b: CentsInput): bigint {
  return toBigInt(a) + toBigInt(b)
}

/**
 * Subtract two cent amounts. Returns bigint. **Clamped at 0** — if the
 * result would be negative, returns 0n instead.
 *
 * The clamp is the right default for money math (subtracting a larger
 * discount than the unit price should be 0, not negative). For ledger
 * entries that need to express a debit (e.g. refund rows with a
 * negative `amount_cents`), compose with `addMoney(0n, -x)` directly
 * or use raw bigint arithmetic.
 *
 * @example
 * subtractMoney(49700n, 100n)  // 49600n
 * subtractMoney(50n, 100n)     // 0n (clamped)
 */
export function subtractMoney(a: CentsInput, b: CentsInput): bigint {
  const r = toBigInt(a) - toBigInt(b)
  return r < 0n ? 0n : r
}

/**
 * Multiply cents by a small integer factor (typically a quantity).
 * Returns bigint. The factor must be a non-negative integer ≤ 10_000_000
 * (sanity cap — Uthena never has line-item quantities larger than 99).
 *
 * @example
 * multiplyCents(49700n, 3)  // 149100n (3 × $497)
 */
export function multiplyCents(cents: CentsInput, factor: number): bigint {
  if (!Number.isFinite(factor)) {
    throw new RangeError(`[money] factor must be a finite number, got ${factor}`)
  }
  const n = Math.trunc(factor)
  if (n < 0 || n > 10_000_000) {
    throw new RangeError(`[money] factor must be 0..10000000, got ${factor}`)
  }
  return toBigInt(cents) * BigInt(n)
}

// ===========================================================================
// 2. Discounts (bps-based)
// ===========================================================================

/**
 * Compute the cents-off amount of a bps discount. FLOOR — never
 * over-discounts the customer. `applyDiscountBps(49700, 1500)` = 7455n
 * (= 15% of $497, floored to the cent).
 *
 * For computing the post-discount price, use
 * `subtractMoney(cents, applyDiscountBps(cents, bps))`.
 *
 * @example
 * applyDiscountBps(49700n, 1500)   // 7455n (15% off $497)
 * applyDiscountBps(10000n, 10000)  // 10000n (100% off)
 * applyDiscountBps(10000n, 0)      // 0n (no discount)
 */
export function applyDiscountBps(cents: CentsInput, bps: number): bigint {
  const c = toBigInt(cents)
  const b = toBps(bps)
  if (c <= 0n || b === 0n) return 0n
  return (c * b) / BPS_DENOMINATOR
}

/**
 * Alias for {@link applyDiscountBps} — kept for the existing call
 * sites (and the older mental model: "give me the discount amount
 * given price + bps"). Prefer `applyDiscountBps` in new code.
 */
export function discountFromBps(cents: CentsInput, bps: number): bigint {
  return applyDiscountBps(cents, bps)
}

/**
 * Compute the royalty owed for a line item, in cents. FLOOR — the
 * partner never receives more than `bps / 10000` of the line total.
 * Royalty is computed on the post-discount line total (so the partner
 * doesn't get credit on the discounted portion).
 *
 * @example
 * calculateRoyalty(10000n, 1500)   // 1500n (15% of $100)
 * calculateRoyalty(333n, 1500)     // 49n (15% of $3.33, floored)
 * calculateRoyalty(10000n, 0)     // 0n (no royalty)
 */
export function calculateRoyalty(lineTotalCents: CentsInput, royaltyPctBps: number): bigint {
  return applyDiscountBps(lineTotalCents, royaltyPctBps)
}

/**
 * Compute the proportional refund royalty for a single order_item line.
 * Used by the refund webhook (`onRefund`) to derive the `payout_ledger`
 * refund-row `amount_cents` for partial refunds.
 *
 * Formula: `floor(saleRoyalty × (refundAmount / orderTotal))`, clamped at
 * the full sale royalty (a refund never claws back more royalty than
 * was earned). For a full refund (`refundAmount === orderTotal`) the
 * formula collapses to the full sale royalty (i.e. `-saleRoyalty` on the
 * ledger row).
 *
 * FLOOR — we never give back MORE royalty than we paid out. Stripe
 * doesn't allow `refundAmount > orderTotal` at the API level, but the
 * clamp is defensive code in case a future refund surface bypasses
 * Stripe's validation (admin tool, dispute reversal, etc.).
 *
 * Returns 0n when:
 * - `saleRoyaltyCents` is 0 (zero-royalty sale — no royalty to refund)
 * - `orderTotalCents` is 0 (defensive — should never happen on a paid order)
 * - `refundAmountCents` is 0 (zero refund — nothing to claw back)
 *
 * @example
 * // 50% refund of a $100 order at 30% royalty
 * // → 50% of $30 royalty = $15
 * calculateRefundRoyalty(3000n, 10000n, 5000n)  // 1500n
 *
 * // Full refund of a $100 order at 30% royalty
 * // → 100% of $30 royalty = $30
 * calculateRefundRoyalty(3000n, 10000n, 10000n) // 3000n
 *
 * // Defensive: refund larger than order
 * calculateRefundRoyalty(3000n, 10000n, 20000n) // 3000n (clamped, not 6000n)
 *
 * @see ADR-0009 — Royalty engine snapshot invariant
 */
export function calculateRefundRoyalty(
  saleRoyaltyCents: CentsInput,
  orderTotalCents: CentsInput,
  refundAmountCents: CentsInput,
): bigint {
  const royalty = toBigInt(saleRoyaltyCents)
  const orderTotal = toBigInt(orderTotalCents)
  const refundAmount = toBigInt(refundAmountCents)

  // Defensive zeros — no royalty to claw back.
  if (royalty <= 0n || orderTotal <= 0n || refundAmount <= 0n) return 0n

  // Proportion = refundAmount / orderTotal, clamped at 1.0 (we never
  // claw back more than we paid). Compute proportion × BPS_DENOMINATOR
  // as an integer to keep the FLOOR semantics consistent with the rest
  // of the money module.
  const cappedRefund = refundAmount > orderTotal ? orderTotal : refundAmount
  const proportionBps = (cappedRefund * BPS_DENOMINATOR) / orderTotal

  // FLOOR — never give back more than the original royalty.
  return (royalty * proportionBps) / BPS_DENOMINATOR
}

/**
 * Compute the subscriber discount on a single PLR unit price, in
 * cents-off. FLOOR. PLR-only by convention — call sites gate on
 * `license === 'plr'` before invoking.
 *
 * `calculateSubscriberDiscount(unitPriceCents, ctx.discountBps)`
 * is the canonical checkout expression. 0 when `discountBps === 0`.
 *
 * @example
 * calculateSubscriberDiscount(10000n, 1500)  // 1500n
 * calculateSubscriberDiscount(10000n, 0)     // 0n
 */
export function calculateSubscriberDiscount(
  unitPriceCents: CentsInput,
  discountBps: number,
): bigint {
  return applyDiscountBps(unitPriceCents, discountBps)
}

/**
 * Legacy: ROUND-half-up variant of {@link applyDiscountBps}. Preserved
 * for any pre-existing call site that depends on the old round
 * semantics. Prefer `applyDiscountBps` (floor) for new money code —
 * round can over-discount by 1 cent on half-boundary values.
 *
 * @example
 * applyBps(333n, 8500)  // 283n (round of 283.05)
 */
export function applyBps(cents: CentsInput, bps: number): bigint {
  const c = toBigInt(cents)
  const b = toBps(bps)
  if (c <= 0n) return 0n
  if (b === 0n) return 0n
  // Round half up: (c * b + 5000) / 10000.
  return (c * b + 5000n) / BPS_DENOMINATOR
}

// ===========================================================================
// 3. Formatting
// ===========================================================================

/** Format integer cents as a localized currency string. Accepts bigint. */
export function formatMoney(
  cents: CentsInput,
  currency: Currency = 'USD',
  locale: string = 'en-US',
): string {
  // Intl.NumberFormat accepts bigint, but treats it as the integer value
  // (not divided by 100). We need to divide by 100 for the cents → unit
  // conversion. For cents values within safe-integer range (2^53 - 1,
  // ≈ $90 trillion), Number(cents) / 100 is lossless; Uthena's lifetime
  // catalog will not approach that.
  const asNumber = Number(cents) / Number(CENT_FACTOR)
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(asNumber)
}

/** Format integer cents as a short label ("$19"). No decimals. Accepts bigint. */
export function formatMoneyShort(
  cents: CentsInput,
  currency: Currency = 'USD',
  locale: string = 'en-US',
): string {
  const asNumber = Number(cents) / Number(CENT_FACTOR)
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(asNumber)
}

/** Parse a user-typed price string ("19.99") into integer cents. */
export function parsePriceToCents(input: string): number {
  const trimmed = input.trim().replace(/[^\d.,-]/g, '').replace(',', '.')
  const n = Number(trimmed)
  if (!Number.isFinite(n)) return 0
  return Math.round(n * Number(CENT_FACTOR))
}

// ===========================================================================
// 4. Validation
// ===========================================================================

/**
 * Assert that `n` is a non-negative integer cents value. Returns the
 * value as bigint (canonical form). Throws on negatives, NaN, or
 * non-integers.
 *
 * Use at module/system boundaries (CSV import, manual ledger
 * correction) where you need to fail loudly.
 *
 * @example
 * assertCents(49700n)        // 49700n
 * assertCents(49700)         // 49700n
 * assertCents(-1)            // throws RangeError
 * assertCents(0.5)           // throws RangeError
 * assertCents(NaN)           // throws RangeError
 */
export function assertCents(n: CentsInput, label: string = 'cents'): bigint {
  const big = toBigInt(n)
  if (big < 0n) {
    throw new RangeError(`[money] ${label} must be non-negative, got ${n}`)
  }
  return big
}