// PendingReview — surface for users whose partner application is in
// `partners.status = 'pending'` (admin review in progress).
//
// P12.1 Slice 1 — implements spec acceptance criterion #4:
//   "Logged-in users with an existing `partners` row in
//    `status = 'pending'` see a 'Your application is being reviewed'
//    state, not the wizard."
//
// What ships here:
//   - Friendly confirmation card
//   - The submitted date (from the partner row's created_at fallback)
//   - One CTA: "Back to your library" (the spec says a wizard user
//     can return to `/library` via Save & exit; the pending-review
//     state surfaces the same destination)

import Link from 'next/link'
import type { PartnerApplicationState } from '../queries/getMyPartnerApplicationStatus'
import styles from './PendingReview.module.css'

export type PendingReviewProps = {
  /** The user's application state. Caller is responsible for ensuring
   *  `state.kind === 'pending'`. */
  state: Extract<PartnerApplicationState, { kind: 'pending' }>
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
          Thanks for applying to teach on Uthena. Our team is reviewing your application now —
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
              An admin checks that your profile, payout, and tax info are complete.
            </span>
          </li>
          <li className={styles.step}>
            <span className={styles.stepNum} aria-hidden="true">2</span>
            <span className={styles.stepText}>
              You receive an approval email with a link back here.
            </span>
          </li>
          <li className={styles.step}>
            <span className={styles.stepNum} aria-hidden="true">3</span>
            <span className={styles.stepText}>
              You can upload your first course right away — courses go through their own
              review before publishing.
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
