// PastDueBanner.tsx — RSC for the failed-payment recovery banner.
//
// Renders when `subscriptions.status === 'past_due'` so the user is
// nudged to update their payment method. The banner is an `<aside
// role="alert" aria-live="assertive">` because the failure requires
// user action — polite announcement would under-emphasise it.
//
// Stripe-not-configured fallback: when `isStripeConfigured()` returns
// false (env not wired in Doppler), the CTA degrades to a "Contact
// support" mailto. The banner is non-critical UI: it never blocks the
// page, and the existing SubscriptionStatusCard below still shows the
// pill + actions. dunning emails are Phase 17 (STUB-052 — out of
// scope for this tick).

import { isStripeConfigured } from '@foundations/money/stripe'
import { PastDueRetryButton } from './PastDueRetryButton'
import styles from './PastDueBanner.module.css'

export function PastDueBanner() {
  const stripeReady = isStripeConfigured()
  return (
    <aside role="alert" aria-live="assertive" className={styles.banner}>
      <div className={styles.icon} aria-hidden="true">
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      </div>
      <div className={styles.body}>
        <p className={styles.headline}>Your last payment failed</p>
        <p className={styles.subhead}>
          Your subscription is past due. Update your payment method to restore full access — Stripe will automatically retry the charge once you do.
        </p>
      </div>
      <div className={styles.cta}>
        {stripeReady ? (
          <PastDueRetryButton />
        ) : (
          <a
            className={styles.ctaFallback}
            href="mailto:support@uthena.com?subject=Past%20due%20subscription"
          >
            Contact support
          </a>
        )}
      </div>
    </aside>
  )
}
