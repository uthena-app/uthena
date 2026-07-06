// ThanksPage — RSC. The post-submit landing at `/partner/onboarding/thanks`.
//
// P12.3 — symmetric counterpart to `WelcomePage`. The page renders
// after the wizard submits (the page-level loader dispatches on
// `partners.status === 'pending' && partner_onboarding_drafts.submitted_at
// IS NOT NULL` before reaching this component). Idempotent on re-visit
// per spec acceptance criterion #4.
//
// What ships here:
//   - H1 + checkmark SVG + lede ("we'll review within 2 business days").
//   - "What happens next" 3-step explainer (review → email → upload).
//   - "In the meantime" 3-item panel (browse, partner guide stub,
//     prepare course outline).
//   - Application reference "#<partners.id>" for support emails.
//   - Sign-out form (server action `signOutAction` → `/`).
//
// No client JS beyond the inline SVG checkmark. No DB writes.

import Link from 'next/link'
import { signOutAction } from '@features/auth/actions'
import styles from './ThanksPage.module.css'

export type ThanksPageProps = {
  /** The application reference (the partner's `partners.id`).
   *  Formatted as `#<id>` for support emails per spec Open Q #2. */
  partnerId: number
  /** ISO timestamp of the submit, used for the "Submitted on"
   *  meta line + the `<time>` element's dateTime. */
  submittedAt: string
  /** Localized date string for the "Submitted on" line. The page
   *  loader computes this in the user's timezone via toLocaleDateString.
   *  Falls back to the raw ISO when this prop is omitted. */
  submittedAtDisplay?: string
  /** Optional href for the "Partner Guide" item — default
   *  `/partner/guide` per spec line 37. The route is a stub in v1;
   *  a full partner handbook ships in v2 per the spec. */
  partnerGuideHref?: string
}

export function ThanksPage({
  partnerId,
  submittedAt,
  submittedAtDisplay,
  partnerGuideHref = '/partner/guide',
}: ThanksPageProps) {
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
        <h1 className={styles.title}>Thanks — we got your application.</h1>
        <p className={styles.lede}>
          We&apos;ll review your application within{' '}
          <strong>2 business days</strong> and email you with a decision
          (approved, returned for changes, or rejected).
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
              Our team reviews your profile, payout, and tax info.
            </span>
          </li>
          <li className={styles.step}>
            <span className={styles.stepNum} aria-hidden="true">
              2
            </span>
            <span className={styles.stepText}>
              We email you with a decision (approved, returned for
              changes, or rejected).
            </span>
          </li>
          <li className={styles.step}>
            <span className={styles.stepNum} aria-hidden="true">
              3
            </span>
            <span className={styles.stepText}>
              Once approved, you can upload your first course right away
              — courses go through their own review before publishing.
            </span>
          </li>
        </ol>
      </section>

      <section className={styles.card} aria-labelledby="thanks-meantime">
        <h2 id="thanks-meantime" className={styles.cardH2}>
          In the meantime
        </h2>
        <ul className={styles.list}>
          <li className={styles.listItem}>
            <Link href="/browse" className={styles.listLink}>
              Browse the catalog
            </Link>
            <span className={styles.listHint}>
              See what other partners are publishing.
            </span>
          </li>
          <li className={styles.listItem}>
            <Link href={partnerGuideHref} className={styles.listLink}>
              Read the Partner Guide
            </Link>
            <span className={styles.listHint}>
              Best practices for titles, pricing, and curriculum.
            </span>
          </li>
          <li className={styles.listItem}>
            <span className={styles.listText}>
              Prepare your first course outline
            </span>
            <span className={styles.listHint}>
              3-5 modules with lesson titles + a 1-paragraph summary each.
            </span>
          </li>
        </ul>
      </section>

      <footer className={styles.footer}>
        <p className={styles.meta}>
          Submitted on{' '}
          <time dateTime={submittedAt}>
            {submittedAtDisplay ?? submittedAt}
          </time>
          .{' '}
          <span className={styles.appId}>
            Application ID: <code>#{partnerId}</code>
          </span>
        </p>

        <nav className={styles.toolbar} aria-label="Application actions">
          <Link href="/browse" className={styles.primary}>
            Browse the catalog
          </Link>
          <form action={signOutAction} className={styles.signOutForm}>
            <button type="submit" className={styles.signOut}>
              Sign out
            </button>
          </form>
        </nav>
      </footer>
    </div>
  )
}