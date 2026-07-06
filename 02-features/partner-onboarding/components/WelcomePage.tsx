// WelcomePage — RSC. The entry surface at `/partner/onboarding/welcome`.
//
// P12.3 — welcome screen for the partner onboarding flow. The page
// itself is a wrapper (no form fields, no DB writes per spec line 38-40).
// All wizard state machine logic lives in `01-specs/pages/partner-onboarding.md`
// and is consumed by `/partner/onboarding` (the wizard). This page is
// the front door.
//
// What ships here:
//   - H1 + lede paragraph (program explanation: 60% revenue share,
//     monthly PayPal payouts, upload → review → publish).
//   - 4-step "What you'll need" checklist (profile, PayPal, tax, KYC).
//   - Primary CTA "Start application" → /partner/onboarding.
//   - Secondary CTA "Not now" → /library.
//   - Footer link "Already approved? Sign in to your partner dashboard"
//     → /login?next=/partner.
//
// No client JS. No DB writes. The partner row check is owned by the
// page-level loader (`app/partner/onboarding/welcome/page.tsx`),
// which dispatches on status before reaching this component.

import Link from 'next/link'
import styles from './WelcomePage.module.css'

const CHECKLIST_ITEMS: ReadonlyArray<{ id: string; body: React.ReactNode }> = [
  {
    id: 'profile',
    body: (
      <>
        <strong>Profile info</strong> — display name, short bio, and a
        headshot for your public partner page.
      </>
    ),
  },
  {
    id: 'payout',
    body: (
      <>
        <strong>PayPal email</strong> — where we&apos;ll send your weekly
        payouts.
      </>
    ),
  },
  {
    id: 'tax',
    body: (
      <>
        <strong>Tax info</strong> — country + tax ID (W-9 for US, W-8BEN
        otherwise).
      </>
    ),
  },
  {
    id: 'kyc',
    body: (
      <>
        <strong>KYC documents</strong> — government ID front + back (for
        first payouts over $600).
      </>
    ),
  },
]

export type WelcomePageProps = {
  /** The primary CTA href. The wizard route in dev might be the
   *  canonical `/partner/onboarding`; a future variant could deep-link
   *  to a specific step (kept as a prop for now to avoid coupling). */
  startHref?: string
  /** The secondary CTA href. Default `/library` per spec Open Q #3. */
  notNowHref?: string
}

export function WelcomePage({
  startHref = '/partner/onboarding',
  notNowHref = '/library',
}: WelcomePageProps = {}) {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Become a partner</p>
        <h1 className={styles.title}>Welcome — let&apos;s get you set up.</h1>
        <p className={styles.lede}>
          Uthena partners earn a{' '}
          <strong className={styles.callout}>60% revenue share</strong> on
          every sale. We pay out weekly via PayPal, you upload courses, we
          review and publish.
        </p>
      </header>

      <section className={styles.card} aria-labelledby="welcome-checklist">
        <h2 id="welcome-checklist" className={styles.cardH2}>
          What you&apos;ll need
        </h2>
        <ul className={styles.checklist}>
          {CHECKLIST_ITEMS.map((item) => (
            <li key={item.id} className={styles.check}>
              <span className={styles.dot} aria-hidden="true">
                ✓
              </span>
              <span className={styles.checkText}>{item.body}</span>
            </li>
          ))}
        </ul>
      </section>

      <nav className={styles.toolbar} aria-label="Welcome actions">
        <Link href={startHref} className={styles.primary}>
          Start application
        </Link>
        <Link href={notNowHref} className={styles.secondary}>
          Not now
        </Link>
      </nav>

      <p className={styles.footer}>
        Already approved?{' '}
        <Link
          href="/login?next=%2Fpartner"
          className={styles.footerLink}
        >
          Sign in to your partner dashboard
        </Link>
        .
      </p>
    </div>
  )
}