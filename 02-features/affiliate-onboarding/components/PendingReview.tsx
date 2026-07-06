// PendingReview — surface for users whose affiliate application is
// in `affiliates.status = 'pending'` (admin review in progress).
//
// P13.1 Slice 1 — implements spec acceptance criterion #3:
//   "Logged-in users with an existing `affiliates` row in
//    `status = 'pending'` see a 'Your application is being reviewed'
//    state, not the wizard."
//
// What ships here:
//   - Friendly confirmation card
//   - The submitted date (from the affiliate row's created_at fallback)
//   - One CTA: "Back to your library" (matches the partner onboarding
//     pattern)

import Link from 'next/link'
import type { AffiliateApplicationState } from '../queries/getMyAffiliateApplicationStatus'
import styles from './PendingReview.module.css'

export type PendingReviewProps = {
  /** The user's application state. Caller is responsible for ensuring
   *  `state.kind === 'pending'`. */
  state: Extract<AffiliateApplicationState, { kind: 'pending' }>
}

export function PendingReview({ state }: PendingReviewProps) {
  const submittedDate = state.submittedAt
    ? new Date(state.submittedAt).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Application in review</p>
        <h1 className={styles.title}>You&apos;re being considered.</h1>
        <p className={styles.lede}>
          Thanks for applying to promote Uthena. Our team is reviewing your application now —
          you&apos;ll hear back by email within <strong>2 business days</strong>.
        </p>
      </header>

      <section className={styles.card} aria-labelledby="pending-status">
        <h2 id="pending-status" className={styles.cardH2}>
          What happens next
        </h2>
        <ol className={styles.steps}>
          <li className={styles.step}>
            <span className={styles.stepNum} aria-hidden="true">1</span>
            <span className={styles.stepText}>
              An admin checks your handle + bio + payout info for completeness.
            </span>
          </li>
          <li className={styles.step}>
            <span className={styles.stepNum} aria-hidden="true">2</span>
            <span className={styles.stepText}>
              You receive an approval email with a link to your affiliate dashboard.
            </span>
          </li>
          <li className={styles.step}>
            <span className={styles.stepNum} aria-hidden="true">3</span>
            <span className={styles.stepText}>
              You can start sharing your affiliate link right away — commissions accrue from
              your first click.
            </span>
          </li>
        </ol>
      </section>

      {submittedDate && (
        <p className={styles.meta}>
          Submitted on <time dateTime={state.submittedAt ?? undefined}>{submittedDate}</time>.
        </p>
      )}

      <nav className={styles.toolbar} aria-label="Pending review actions">
        <Link href="/library" className={styles.cta}>
          Back to your library
        </Link>
      </nav>
    </div>
  )
}