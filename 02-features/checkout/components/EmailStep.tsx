// EmailStep.tsx — first step of the checkout wizard (P4.7).
//
// RSC. Shows the buyer where the receipt + library access will land
// (their account email), with a clear path to change it. The actual
// email-change flow is owned by P9.3 (account email change), so the
// step links into the existing /account/settings page rather than
// reimplementing the verification handshake here. The "Continue" CTA
// is a plain `<Link>` to ?step=review — no client JS, full back-button
// support.

import Link from 'next/link'
import { checkoutStepHref } from './parseCheckoutStep'
import styles from './EmailStep.module.css'

export type EmailStepProps = {
  /** The account email we'll send the receipt + library grants to. */
  email: string
  /** Display name (optional — purely cosmetic). */
  displayName?: string | null
}

export function EmailStep({ email, displayName }: EmailStepProps) {
  return (
    <section className={styles.wrap} aria-labelledby="checkout-email-h">
      <header className={styles.header}>
        <h2 id="checkout-email-h" className={styles.h2}>
          Where should we send your receipt?
        </h2>
        <p className={styles.lede}>
          Receipts, library access links, and any course updates land here. You can
          change this any time before paying.
        </p>
      </header>

      <dl className={styles.fields}>
        <div className={styles.field}>
          <dt className={styles.fieldLabel}>Email</dt>
          <dd className={styles.fieldValue}>
            <span className={styles.emailPill}>{email || '(missing account email)'}</span>
          </dd>
        </div>
        {displayName && (
          <div className={styles.field}>
            <dt className={styles.fieldLabel}>Name on receipt</dt>
            <dd className={styles.fieldValue}>{displayName}</dd>
          </div>
        )}
      </dl>

      <p className={styles.changeNote}>
        Need to use a different email?{' '}
        <Link href="/account/settings" className={styles.changeLink}>
          Update it in account settings
        </Link>{' '}
        and come back here.
      </p>

      <div className={styles.actions}>
        <Link href="/cart" className={styles.secondaryCta}>
          ← Back to cart
        </Link>
        <Link href={checkoutStepHref('review')} className={styles.primaryCta}>
          Continue to review →
        </Link>
      </div>
    </section>
  )
}