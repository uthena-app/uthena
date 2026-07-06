// ThanksPage — RSC. The post-submit landing at `/affiliate/onboarding/thanks`.
//
// P13.2 — symmetric counterpart to `WelcomePage`. The page renders
// after the wizard submits (the page-level loader dispatches on
// `affiliates.status === 'pending' && affiliate_onboarding_drafts.
// submitted_at IS NOT NULL` before reaching this component).
// Idempotent on re-visit per spec acceptance criterion #4.
//
// What ships here:
//   - Inline SVG checkmark + "Application received!" headline + lede
//     ("we'll review within 2 business days and email you at <email>").
//   - "What happens next" 3-step explainer (review → email → dashboard).
//   - Application reference "#<affiliates.id>" for support emails.
//   - Toolbar: "View my account" (primary) + "Sign out" (form).
//   - Footer with the page's last-updated date.
//
// No client JS beyond the inline SVG checkmark. No DB writes.

import Link from 'next/link'
import { signOutAction } from '@features/auth/actions'
import styles from './ThanksPage.module.css'

export type ThanksPageProps = {
  /** The application reference (the affiliate's `affiliates.id`).
   *  Formatted as `#<id>` for support emails per spec Open Q #2. */
  affiliateId: number
  /** The user's email — shown in step 2 of the "What happens next"
   *  explainer ("we'll email you at <email>"). Never used for any
   *  other display, never logged. */
  email: string
}

export function ThanksPage({ affiliateId, email }: ThanksPageProps) {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.checkmarkWrap} aria-hidden="true">
          <svg
            className={styles.checkmark}
            viewBox="0 0 64 64"
            xmlns="http://www.w3.org/2000/svg"
            focusable="false"
          >
            <circle
              cx="32"
              cy="32"
              r="30"
              fill="var(--success-soft, rgba(46, 196, 182, 0.12))"
              stroke="var(--success)"
              strokeWidth="2"
            />
            <path
              d="M19 33 L28 42 L46 22"
              fill="none"
              stroke="var(--success)"
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <p className={styles.eyebrow}>Application received</p>
        <h1 className={styles.title}>Application received!</h1>
        <p className={styles.lede}>
          We&apos;ll review your application within{' '}
          <strong>2 business days</strong> and email you at{' '}
          <strong>{email}</strong> with our decision.
        </p>
      </header>

      <section className={styles.card} aria-labelledby="thanks-next">
        <h2 id="thanks-next" className={styles.cardH2}>
          What happens next
        </h2>
        <ol className={styles.steps}>
          <li className={styles.step}>
            <span className={styles.stepNum} aria-hidden="true">
              1
            </span>
            <span className={styles.stepText}>
              Our team reviews your application (usually within{' '}
              <strong>2 business days</strong>).
            </span>
          </li>
          <li className={styles.step}>
            <span className={styles.stepNum} aria-hidden="true">
              2
            </span>
            <span className={styles.stepText}>
              You&apos;ll get an email at <strong>{email}</strong> when
              we decide.
            </span>
          </li>
          <li className={styles.step}>
            <span className={styles.stepNum} aria-hidden="true">
              3
            </span>
            <span className={styles.stepText}>
              If approved, you&apos;ll get access to your dashboard at{' '}
              <Link href="/affiliate" className={styles.inlineLink}>
                /affiliate
              </Link>
              .
            </span>
          </li>
        </ol>
      </section>

      <footer className={styles.footer}>
        <p className={styles.meta}>
          <span className={styles.appId}>
            Application ID: <code>#{affiliateId}</code>
          </span>
        </p>

        <nav className={styles.toolbar} aria-label="Application actions">
          <Link href="/account" className={styles.primary}>
            View my account
          </Link>
          <form action={signOutAction} className={styles.signOutForm}>
            <button type="submit" className={styles.signOut}>
              Sign out
            </button>
          </form>
        </nav>

        <p className={styles.pageFooter}>
          Last updated:{' '}
          <time dateTime={LAST_UPDATED_ISO} className={styles.footerDate}>
            {LAST_UPDATED_DISPLAY}
          </time>
          . Need help?{' '}
          <Link href="/contact" className={styles.footerLink}>
            Contact support
          </Link>
          .
        </p>
      </footer>
    </div>
  )
}

// Hard-coded so the page never silently drifts on re-render. Update
// these when the page copy / flow changes — they're the "freshness"
// signal to the user.
const LAST_UPDATED_ISO = '2026-06-30'
const LAST_UPDATED_DISPLAY = 'June 30, 2026'