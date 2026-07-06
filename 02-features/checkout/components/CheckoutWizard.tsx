// CheckoutWizard.tsx — orchestrator for the P4.7 multi-step checkout.
//
// RSC. URL-driven (`?step=email|review`), so back/forward and shareable
// links work for free. The Payment step is on Stripe's domain (we
// redirect), and Confirmation is the existing /checkout/success page
// — neither lives inside this wizard. The wizard therefore only
// renders the two local steps, but the CheckoutStepper shows all four
// so users see "Payment + Done are next" as soon as they start.
//
// All data fetching is the caller's responsibility — the wizard is
// a pure rendering layer. /checkout/page.tsx resolves `?step=`,
// reads the cart + coupon + subscriber discount + stripe readiness,
// and hands the resulting payload here. The wizard does no DB / I/O
// of its own; that keeps it easy to test (the parseCheckoutStep
// helper is the only pure logic in the checkout step machinery) and
// lets the page route own its caching + revalidation policy.

import type { CartLine } from '@features/cart/queries/getCart'
import type { AppliedCoupon } from '@features/cart'
import type { CartSubscriberDiscountResult } from '@features/subscriptions'
import { CheckoutStepper } from './CheckoutStepper'
import { EmailStep } from './EmailStep'
import { ReviewStep } from './ReviewStep'
import { parseCheckoutStep } from './parseCheckoutStep'
import styles from './CheckoutWizard.module.css'

export type CheckoutWizardProps = {
  /** Raw `?step=` value from the request. The wizard normalizes it
   *  via `parseCheckoutStep` so an unknown / missing value falls
   *  back to 'email'. */
  rawStep: string | string[] | undefined
  /** The authenticated user — used for the email step + as the
   *  recipient on the Pay button. */
  user: {
    email: string | null
    display_name?: string | null
  }
  /** Auth-resolved cart lines. Server-only, RLS-aware. */
  lines: CartLine[]
  /** Cart subtotal in cents (number). */
  subtotalCents: number
  /** Currently applied coupon (or null). */
  appliedCoupon: AppliedCoupon | null
  /** True when `isStripeConfigured()` is true — controls the Pay
   *  button's enabled state. */
  stripeReady: boolean
  /** P5.9 — Pre-computed subscriber-discount breakdown (per-line +
   *  total). The ReviewStep renders the "Subscriber discount" row +
   *  per-line "Subscriber 15% off" tag from this data. The action
   *  uses the same shared helper so the UI total cannot disagree
   *  with what Stripe charges. */
  subscriberDiscount: CartSubscriberDiscountResult
}

export function CheckoutWizard({
  rawStep,
  user,
  lines,
  subtotalCents,
  appliedCoupon,
  stripeReady,
  subscriberDiscount,
}: CheckoutWizardProps) {
  const parsed = parseCheckoutStep(rawStep)

  return (
    <div className={styles.wizard}>
      <header className={styles.stepperRow}>
        <CheckoutStepper currentStep={parsed.id} />
      </header>

      <div className={styles.body} data-step={parsed.id}>
        {parsed.id === 'email' && (
          <EmailStep email={user.email ?? ''} displayName={user.display_name ?? null} />
        )}
        {parsed.id === 'review' && (
          <ReviewStep
            lines={lines}
            subtotalCents={subtotalCents}
            appliedCoupon={appliedCoupon}
            stripeReady={stripeReady}
            email={user.email ?? ''}
            subscriberDiscount={subscriberDiscount}
          />
        )}
      </div>
    </div>
  )
}