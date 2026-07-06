// WelcomePage — RSC. The entry surface at `/affiliate/onboarding/welcome`.
//
// P13.2 — welcome screen for the affiliate onboarding flow. The page
// itself is a wrapper (no form fields, no DB writes per spec line 38-40).
// All wizard state machine logic lives in `01-specs/pages/affiliate-onboarding.md`
// and is consumed by `/affiliate/onboarding` (the wizard). This page is
// the front door — a "you're in" confirmation + 4-step "What happens
// next" orientation for users who just signed up.
//
// What ships here:
//   - Banner (teal accent — `--success` token) + "Welcome, {firstName}!"
//     headline + 1-paragraph program recap.
//   - 4-step "What happens next" explainer (wizard → admin review →
//     handle + payout setup → start sharing).
//   - Primary CTA "Continue onboarding →" → /affiliate/onboarding.
//   - Secondary CTA "Sign out" form (server action `signOutAction` → `/`).
//   - Footer with the page's last-updated date.
//
// No client JS. No DB writes. The affiliate-row status check is owned
// by the page-level loader
// (`app/affiliate/onboarding/welcome/page.tsx`), which dispatches on
// status before reaching this component.

import Link from 'next/link'
import { signOutAction } from '@features/auth/actions'
import styles from './WelcomePage.module.css'

export type WelcomePageProps = {
  /** The user's first name / display name. The page renders
   *  "Welcome, {firstName}!". Falls back to a generic greeting when
   *  omitted so the page never renders an empty headline. */
  firstName?: string
}

const NEXT_STEPS: ReadonlyArray<{ id: string; body: React.ReactNode }> = [
  {
    id: 'wizard',
    body: (
      <>
        Complete the onboarding wizard at{' '}
        <Link href="/affiliate/onboarding" className={styles.inlineLink}>
          /affiliate/onboarding
        </Link>{' '}
        — pick your handle, fill in your bio, and set up payout.
      </>
    ),
  },
  {
    id: 'review',
    body: (
      <>
        Admin reviews your application (usually within{' '}
        <strong>2 business days</strong>) — we email you with the
        decision.
      </>
    ),
  },
  {
    id: 'approved',
    body: (
      <>
        Once approved, you get your unique handle (your public URL at{' '}
        <code className={styles.code}>uthena.com/your-name</code>) and
        set up your payout method.
      </>
    ),
  },
  {
    id: 'promote',
    body: (
      <>
        Start sharing your affiliate links — earn{' '}
        <strong>20% commission</strong> on every sale for 30 days after
        the click.
      </>
    ),
  },
]

export function WelcomePage({ firstName }: WelcomePageProps = {}) {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Affiliate onboarding</p>
        <h1 className={styles.title}>
          Welcome{firstName ? `, ${firstName}` : ''}!
        </h1>
        <p className={styles.lede}>
          You&apos;re in. The onboarding wizard takes about 5 minutes —
          handle, short bio, PayPal email, agreement to the Affiliate
          Terms. Then we review and you&apos;re live.
        </p>
      </header>

      <section className={styles.card} aria-labelledby="welcome-next">
        <h2 id="welcome-next" className={styles.cardH2}>
          What happens next
        </h2>
        <ol className={styles.steps}>
          {NEXT_STEPS.map((item, i) => (
            <li key={item.id} className={styles.step}>
              <span className={styles.stepNum} aria-hidden="true">
                {i + 1}
              </span>
              <span className={styles.stepText}>{item.body}</span>
            </li>
          ))}
        </ol>
      </section>

      <nav className={styles.toolbar} aria-label="Welcome actions">
        <Link href="/affiliate/onboarding" className={styles.primary}>
          Continue onboarding →
        </Link>
        <form action={signOutAction} className={styles.signOutForm}>
          <button type="submit" className={styles.signOut}>
            Sign out
          </button>
        </form>
      </nav>

      <p className={styles.footer}>
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
    </div>
  )
}

// Hard-coded so the page never silently drifts on re-render. Update
// these when the page copy / flow changes — they're the "freshness"
// signal to the user.
const LAST_UPDATED_ISO = '2026-06-30'
const LAST_UPDATED_DISPLAY = 'June 30, 2026'