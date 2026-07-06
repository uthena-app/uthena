// calculateCartSubscriberDiscount.ts — pure discount math for a cart.
//
// P5.9 single source of truth. Both the UI (ReviewStep row) and the
// server action (createCheckoutSession) call this helper so they
// can't disagree about who's eligible, how much they save, or which
// tiers opted out.
//
// Money: returns bigint (cents). Caller converts to number only at
// the DB write / display boundary. Discount is FLOOR-based (via
// applyDiscountBps / calculateSubscriberDiscount) so we never
// over-discount a customer.
//
// Eligibility rules (mirroring createCheckoutSession.ts:151-202):
//   1. The user must have an active or trialing subscription
//      (discountCtx.isActive = true).
//   2. The line must be PLR license. MRR / RR / personal are not
//      subscriber-discount eligible — that's the spec's PLR-only
//      carve-out.
//   3. The (product, license) tier's `subscriber_discount_bps`:
//      - null  → inherit the platform default (discountCtx.discountBps)
//      - 0     → partner has explicitly opted this tier OUT — no discount
//      - N>0   → partner has set a custom rate (e.g. 1000 = 10%)
//
// The per-line discount is `applyDiscountBps(unitPrice, rowDiscountBps)`
// multiplied by quantity. Royalty is NOT computed here — that's the
// action's concern (it needs the partner's royalty_pct_bps which is
// out of scope for the UI display).
//
// Pure function. No DB. No I/O. Easy to unit-test with tables of
// scenarios.

import type { CartLine } from '@features/cart/queries/getCart'
import { applyDiscountBps, multiplyCents } from '@foundations/money/cents'
import type { DiscountContext } from '../queries/getSubscriberDiscountContext'

/** One line's subscriber discount, computed from a CartLine. */
export type CartSubscriberDiscountLine = {
  /** The cart line id (auth number or anon string). */
  line_id: CartLine['id']
  product_id: number
  /** True iff this line actually got a discount (eligible + bps > 0). */
  applied: boolean
  /** The basis-points rate that was applied (0 when not applied). */
  bps: number
  /** Discount in cents for this single line (unit discount * quantity). */
  discount_cents: bigint
}

/** The shape the helper returns — per-line detail + a total. */
export type CartSubscriberDiscountResult = {
  /** Sum of per-line discount_cents. 0n when no lines qualify. */
  total_cents: bigint
  /** Per-line breakdown for UI disclosure ("Subscriber 15% off" tags). */
  lines: CartSubscriberDiscountLine[]
  /** True iff any line received a discount. UI uses this to decide
   *  whether to render the "Subscriber discount" totals row. */
  any_applied: boolean
}

/**
 * Resolve the effective per-line bps for a cart line given the
 * discount context. Mirrors the createCheckoutSession eligibility
 * logic so both call sites agree.
 *
 * Returns 0 (no discount) when:
 *   - the user isn't a subscriber
 *   - the line isn't PLR
 *   - the partner explicitly set `subscriber_discount_bps = 0`
 *
 * Returns `discountCtx.discountBps` (platform default) when:
 *   - the tier's per-row override is null
 *
 * Returns the tier's value when:
 *   - the tier has a numeric `subscriber_discount_bps` (incl. 0)
 */
export function resolveLineSubscriberBps(
  line: Pick<CartLine, 'license' | 'subscriber_discount_bps'>,
  discountCtx: DiscountContext,
): number {
  if (!discountCtx.isActive) return 0
  if (line.license !== 'plr') return 0
  if (typeof line.subscriber_discount_bps === 'number') {
    // Explicit per-tier override — 0 means "opted out".
    return line.subscriber_discount_bps
  }
  // null = inherit platform default.
  return discountCtx.discountBps
}

/**
 * Compute the subscriber discount for an entire cart in one pass.
 * Returns bigint cents totals + per-line detail.
 */
export function calculateCartSubscriberDiscount(
  lines: readonly CartLine[],
  discountCtx: DiscountContext,
): CartSubscriberDiscountResult {
  const detail: CartSubscriberDiscountLine[] = []
  let totalCents = 0n
  for (const line of lines) {
    const bps = resolveLineSubscriberBps(line, discountCtx)
    if (bps <= 0) {
      detail.push({
        line_id: line.id,
        product_id: line.product_id,
        applied: false,
        bps: 0,
        discount_cents: 0n,
      })
      continue
    }
    const unitDiscount = applyDiscountBps(line.unit_price_cents, bps)
    const lineDiscount = multiplyCents(unitDiscount, line.quantity)
    detail.push({
      line_id: line.id,
      product_id: line.product_id,
      applied: true,
      bps,
      discount_cents: lineDiscount,
    })
    totalCents += lineDiscount
  }
  return {
    total_cents: totalCents,
    lines: detail,
    any_applied: detail.some((d) => d.applied),
  }
}