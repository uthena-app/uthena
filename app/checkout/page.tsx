// /checkout — multi-step checkout wizard (P4.7).
//
// RSC. Auth-gated. URL-driven via `?step=email|review` so the
// back button + shareable links just work. The Payment step happens
// on Stripe's domain (we redirect via createCheckoutSessionAction);
// the Confirmation step is /checkout/success. Neither is rendered
// here — the wizard only owns the local steps.
//
// Data fetching is parallelized: cart lines + subtotal + coupon +
// subscriber-discount + stripe-readiness all load in one go via
// Promise.all. The wizard itself is a pure rendering layer
// (`CheckoutWizard`); the parser + step bodies live in
// 02-features/checkout/components/.

import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { requireUser } from '@foundations/auth/guards'
import {
  getCart,
  getCartSubtotalCents,
  getAppliedCoupon,
} from '@features/cart'
import {
  calculateCartSubscriberDiscount,
  getSubscriberDiscountContext,
} from '@features/subscriptions'
import { isStripeConfigured } from '@foundations/money/stripe'
import { sensitivePageMetadata } from '@foundations/metadata'
import { CheckoutWizard } from '@features/checkout'
import styles from './checkout.module.css'

// P0.21 — `noindex` so the checkout surface isn't indexed.
export const metadata: Metadata = sensitivePageMetadata({
  title: 'Checkout',
  description: 'Complete your Uthena order — review items, choose a license, and pay.',
  path: '/checkout',
})
export const dynamic = 'force-dynamic'

type Search = Promise<{ step?: string | string[] }>

export default async function CheckoutPage({ searchParams }: { searchParams: Search }) {
  const user = await requireUser('/checkout')
  const sp = await searchParams
  const [lines, subtotalCents, appliedCoupon, discountCtx, stripeReady] = await Promise.all([
    getCart(),
    getCartSubtotalCents(),
    getAppliedCoupon(),
    getSubscriberDiscountContext(user.id),
    Promise.resolve(isStripeConfigured()),
  ])

  if (lines.length === 0) {
    // Empty cart: redirect to /cart to either remove items or browse.
    redirect('/cart')
  }

  // P5.9 — UI display of the subscriber discount. The action
  // (createCheckoutSession) recomputes this server-side with the
  // same shared helper, so the UI total can never disagree with the
  // amount Stripe actually charges.
  const subscriberDiscount = calculateCartSubscriberDiscount(lines, discountCtx)

  return (
    <main id="main" className={styles.page}>
      <h1 className={styles.h1}>Checkout</h1>
      <CheckoutWizard
        rawStep={sp.step}
        user={{ email: user.email, display_name: null }}
        lines={lines}
        subtotalCents={subtotalCents}
        appliedCoupon={appliedCoupon}
        stripeReady={stripeReady}
        subscriberDiscount={subscriberDiscount}
      />
    </main>
  )
}