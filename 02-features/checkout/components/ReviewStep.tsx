// ReviewStep.tsx — second step of the checkout wizard (P4.7).
//
// RSC. Renders the full order review: line items on the left, the
// itemized summary + coupon form + Pay button on the right. This is
// the same surface the old single-page /checkout rendered, scoped to
// one step. The Pay button still calls createCheckoutSessionAction
// and redirects to Stripe Checkout (the "Payment" step happens on
// Stripe's domain — we don't render a card form ourselves).
//
// P5.9 — Subscriber discount: the per-line "Subscriber 15% off" tag
// (when applicable) + the totals-row "Subscriber discount" line. Both
// are derived from the shared `calculateCartSubscriberDiscount` helper,
// which the server action uses too — so the UI total can never
// disagree with the amount Stripe charges.

import Link from 'next/link'
import type { CartLine } from '@features/cart/queries/getCart'
import { applyDiscountBps, formatMoney } from '@foundations/money/cents'
import { LICENSE_LABELS } from '@features/cart/format'
import type { CartSubscriberDiscountResult } from '@features/subscriptions'
import { checkoutStepHref } from './parseCheckoutStep'
import { PayButton } from './PayButton'
import { CouponForm } from '@features/cart'
import type { AppliedCoupon } from '@features/cart'
import styles from './ReviewStep.module.css'

export type ReviewStepProps = {
  lines: CartLine[]
  subtotalCents: number
  appliedCoupon: AppliedCoupon | null
  stripeReady: boolean
  email: string
  /** P5.9 — Subscriber discount breakdown (per-line + total). The page
   *  pre-computes this from `calculateCartSubscriberDiscount` so this
   *  component stays a pure rendering layer. */
  subscriberDiscount: CartSubscriberDiscountResult
}

export function ReviewStep({
  lines,
  subtotalCents,
  appliedCoupon,
  stripeReady,
  email,
  subscriberDiscount,
}: ReviewStepProps) {
  const couponApplied = appliedCoupon && appliedCoupon.applied_to_lines > 0
  const couponDiscountCents = couponApplied ? applyDiscountBps(subtotalCents, appliedCoupon.discount_bps) : 0n
  const subscriberDiscountCents = subscriberDiscount.total_cents
  const totalCents =
    BigInt(subtotalCents) - couponDiscountCents - subscriberDiscountCents

  // Index the per-line breakdown by line id for O(1) lookup when
  // rendering each cart item's "Subscriber 15% off" tag.
  const lineDiscountById = new Map(subscriberDiscount.lines.map((d) => [d.line_id, d]))

  return (
    <section className={styles.wrap} aria-labelledby="checkout-review-h">
      <header className={styles.header}>
        <h2 id="checkout-review-h" className={styles.h2}>
          Review your order
        </h2>
        <p className={styles.lede}>
          Confirm the items and total below. When you pay, we redirect you to Stripe for
          the secure card form — your library is provisioned automatically on success.
        </p>
      </header>

      <div className={styles.layout}>
        <div className={styles.left} aria-label="Order items">
          <h3 className={styles.sub}>Items</h3>
          <ul className={styles.items}>
            {lines.map((line) => {
              const lineDiscount = lineDiscountById.get(line.id)
              return (
                <li key={String(line.id)} className={styles.item}>
                  {line.thumbnail_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={line.thumbnail_url} alt="" className={styles.thumb} />
                  ) : (
                    <div className={styles.thumbPlaceholder} aria-hidden />
                  )}
                  <div className={styles.itemBody}>
                    <Link href={`/products/${line.slug}`} className={styles.title}>
                      {line.title}
                    </Link>
                    <p className={styles.meta}>
                      {LICENSE_LABELS[line.license] ?? line.license} · Qty {line.quantity}
                    </p>
                    {/* P5.9 — Per-line subscriber discount disclosure. */}
                    {lineDiscount?.applied && (
                      <p className={styles.subscriberTag} aria-label="Subscriber discount applied">
                        Subscriber {(lineDiscount.bps / 100).toFixed(lineDiscount.bps % 100 === 0 ? 0 : 2)}% off
                      </p>
                    )}
                  </div>
                  <p className={styles.itemPrice}>{formatMoney(line.line_total_cents, 'USD')}</p>
                </li>
              )
            })}
          </ul>
          <p className={styles.editNote}>
            Need to change something?{' '}
            <Link href="/cart" className={styles.editLink}>
              Edit your cart
            </Link>
            .
          </p>
        </div>

        <aside className={styles.right} aria-label="Order summary">
          <h3 className={styles.sub}>Summary</h3>
          <dl className={styles.totals}>
            <div className={styles.row}>
              <dt>Subtotal</dt>
              <dd>{formatMoney(subtotalCents, 'USD')}</dd>
            </div>
            {couponApplied && (
              <div className={styles.row}>
                <dt>
                  Discount <span className={styles.couponTag}>{appliedCoupon.code}</span>
                </dt>
                <dd className={styles.discount}>−{formatMoney(couponDiscountCents, 'USD')}</dd>
              </div>
            )}
            {/* P5.9 — Subscriber discount totals row. Renders only when
                at least one line actually got a discount (any_applied).
                Per-line tag above shows the rate; this row aggregates. */}
            {subscriberDiscount.any_applied && (
              <div className={styles.row}>
                <dt>Subscriber discount</dt>
                <dd className={styles.discount}>−{formatMoney(subscriberDiscountCents, 'USD')}</dd>
              </div>
            )}
            <div className={styles.row}>
              <dt>Tax</dt>
              <dd className={styles.muted}>Calculated by Stripe at payment</dd>
            </div>
            <div className={`${styles.row} ${styles.grand}`}>
              <dt>Total</dt>
              <dd>{formatMoney(totalCents, 'USD')}</dd>
            </div>
          </dl>

          <div className={styles.couponBlock}>
            <CouponForm
              applied={
                couponApplied
                  ? { code: appliedCoupon.code, label: appliedCoupon.discount_label }
                  : null
              }
            />
          </div>

          {!stripeReady && (
            <div role="alert" className={styles.notice}>
              <strong>Payments disabled.</strong>{' '}
              <code>STRIPE_SECRET_KEY</code> is not set in this environment, so checkout
              will fail. Set the key in <code>.env.local</code> or Doppler, then refresh.
              (See <code>STUB-002</code>.)
            </div>
          )}

          <PayButton disabled={!stripeReady} email={email} />

          <ul className={styles.trust}>
            <li>14-day return rights</li>
            <li>Secure checkout (Stripe)</li>
            <li>Instant download after payment</li>
          </ul>

          <p className={styles.legalNote}>
            By paying you agree to our{' '}
            <Link href="/terms" className={styles.legalLink}>
              Terms
            </Link>{' '}
            and{' '}
            <Link href="/refund-policy" className={styles.legalLink}>
              Refund Policy
            </Link>
            .
          </p>
        </aside>
      </div>

      <div className={styles.navRow}>
        <Link href={checkoutStepHref('email')} className={styles.backLink}>
          ← Back to email
        </Link>
      </div>
    </section>
  )
}