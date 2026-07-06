// StartSubscriptionCard.tsx — empty-state for non-subscribers.

import { PLAN_NAME } from '@features/subscriptions'
import { StartSubscriptionButton } from './StartSubscriptionButton'
import styles from './StartSubscriptionCard.module.css'

export function StartSubscriptionCard({
  stripeReady,
  priceConfigured,
}: {
  stripeReady: boolean
  priceConfigured: boolean
}) {
  return (
    <section className={styles.card} aria-label="Subscribe to Personal Access">
      <header className={styles.head}>
        <p className={styles.eyebrow}>Recommended</p>
        <h2 className={styles.h2}>{PLAN_NAME}</h2>
        <p className={styles.price}>
          $19<span className={styles.per}>/month</span>
        </p>
        <p className={styles.tagline}>
          Save 15% on every PLR course you buy.
        </p>
      </header>

      <ul className={styles.list}>
        <li>15% discount on every PLR-tier one-time order</li>
        <li>Works on every product in the catalog</li>
        <li>Cancel anytime — your access continues until the period ends</li>
        <li>Secure billing via Stripe</li>
      </ul>

      {(!stripeReady || !priceConfigured) && (
        <div role="alert" className={styles.notice}>
          <strong>Subscriptions are temporarily disabled.</strong>{' '}
          Stripe is not fully configured in this environment
          {(!priceConfigured && stripeReady) && ' (missing STRIPE_PRICE_PERSONAL_ACCESS_MONTHLY)'}
          . Add the keys and refresh. (See <code>STUB-002</code>.)
        </div>
      )}

      <StartSubscriptionButton disabled={!stripeReady || !priceConfigured} />
    </section>
  )
}
