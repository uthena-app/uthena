// WelcomeStep — Step 1 of the partner-onboarding wizard.
//
// P12.1 Slice 1 — Welcome copy per spec.
//
// Why this is a real component (not a `<StepPlaceholder>`):
//   - The Welcome step has no form fields. It's a one-time orientation
//     screen, not an input surface.
//   - It owns the spec's "What you'll need" checklist + the revenue
//     share value prop + the terms link.
//
// The Restart / Start over button ships with the dashboard surface in
// a later slice (STUB-089 — requires a delete-the-draft server
// action that is not in scope for Slice 1).

import Link from 'next/link'
import styles from './WelcomeStep.module.css'

export function WelcomeStep() {
  return (
    <div className={styles.wrap}>
      <h2 className={styles.h2}>Welcome — let&apos;s get you set up</h2>
      <p className={styles.lede}>
        We&apos;re glad you&apos;re interested in teaching on Uthena. Partners earn a
        <strong className={styles.callout}> 60% revenue share </strong>
        on every sale, with weekly payouts and a dashboard that tracks lifetime earnings,
        per-product sales, and tax documents in one place.
      </p>

      <section className={styles.what} aria-labelledby="welcome-what">
        <h3 id="welcome-what" className={styles.h3}>
          What you&apos;ll need
        </h3>
        <ul className={styles.checklist}>
          <li className={styles.check}>
            <span className={styles.dot} aria-hidden="true">
              ✓
            </span>
            <span>A short bio and headshot for your public partner profile.</span>
          </li>
          <li className={styles.check}>
            <span className={styles.dot} aria-hidden="true">
              ✓
            </span>
            <span>A PayPal email for payouts (we&apos;ll use it for weekly transfers).</span>
          </li>
          <li className={styles.check}>
            <span className={styles.dot} aria-hidden="true">
              ✓
            </span>
            <span>Tax info: a W-9 (US) or W-8BEN (international) form.</span>
          </li>
          <li className={styles.check}>
            <span className={styles.dot} aria-hidden="true">
              ✓
            </span>
            <span>A read of our{' '}
              <Link href="/terms" className={styles.inlineLink}>Terms of Service</Link>{' '}
              and{' '}
              <Link href="/partner-onboarding/welcome" className={styles.inlineLink}>
                Partner Agreement
              </Link>
              .
            </span>
          </li>
        </ul>
      </section>

      <aside className={styles.note} role="note">
        <p className={styles.noteText}>
          <strong>How long does this take?</strong> Most partners finish in about 8 minutes.
          Your progress is saved automatically — close this tab and come back any time within
          30 days.
        </p>
      </aside>
    </div>
  )
}
