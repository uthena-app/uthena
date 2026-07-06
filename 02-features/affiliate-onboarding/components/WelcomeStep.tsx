// WelcomeStep — Step 1 body for the affiliate onboarding wizard.
//
// P13.1 Slice 1 — copy + "What you'll need" checklist + "Start" CTA.
// Per spec §"What this page does":
//   - Hard-coded copy: 20% commission, 30-day cookie window, payment terms,
//     "What you'll need" checklist.
//   - One primary CTA ("Start") which the shell's ContinueButton advances
//     to step 2 (handle_bio).
//
// The spec says no Start button on this step — only the Continue CTA in
// the shell toolbar. The Welcome page renders copy + a checklist; the
// Continue button (in the shell) advances to step 2.

import styles from './WelcomeStep.module.css'

export function WelcomeStep() {
  return (
    <div className={styles.wrap}>
      <p className={styles.eyebrow}>Welcome</p>
      <h2 className={styles.h2}>Promote Uthena, earn 20% commission.</h2>
      <p className={styles.lede}>
        Share products you love. Earn recurring commission on every sale — paid out weekly via
        PayPal. The wizard takes about 5 minutes.
      </p>

      <ul className={styles.facts}>
        <li className={styles.fact}>
          <span className={styles.factLabel}>Commission</span>
          <span className={styles.factValue}>20%</span>
        </li>
        <li className={styles.fact}>
          <span className={styles.factLabel}>Cookie window</span>
          <span className={styles.factValue}>30 days</span>
        </li>
        <li className={styles.fact}>
          <span className={styles.factLabel}>Payment</span>
          <span className={styles.factValue}>Weekly · PayPal</span>
        </li>
        <li className={styles.fact}>
          <span className={styles.factLabel}>Payout minimum</span>
          <span className={styles.factValue}>$50</span>
        </li>
      </ul>

      <h3 className={styles.h3}>What you&apos;ll need</h3>
      <ul className={styles.checklist}>
        <li className={styles.checkItem}>
          <span className={styles.checkBullet} aria-hidden="true">
            ✓
          </span>
          <span>
            <strong>A handle</strong> — the unique URL segment for your public mini-shop, like{' '}
            <code className={styles.code}>uthena.com/your-name</code>.
          </span>
        </li>
        <li className={styles.checkItem}>
          <span className={styles.checkBullet} aria-hidden="true">
            ✓
          </span>
          <span>
            <strong>A short bio</strong> — 1-2 sentences about who you are and what you promote.
          </span>
        </li>
        <li className={styles.checkItem}>
          <span className={styles.checkBullet} aria-hidden="true">
            ✓
          </span>
          <span>
            <strong>A PayPal email</strong> — where we&apos;ll send your weekly payouts.
          </span>
        </li>
        <li className={styles.checkItem}>
          <span className={styles.checkBullet} aria-hidden="true">
            ✓
          </span>
          <span>
            <strong>5 minutes</strong> — the wizard saves after every step, so you can leave and
            come back.
          </span>
        </li>
      </ul>

      <p className={styles.note}>
        By continuing you agree to our{' '}
        <a href="/affiliate-terms" className={styles.inlineLink}>
          Affiliate Terms
        </a>
        . Full review usually takes 2 business days.
      </p>
    </div>
  )
}