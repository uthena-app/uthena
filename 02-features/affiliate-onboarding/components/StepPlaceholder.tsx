// StepPlaceholder — generic step body for steps that are scaffolded
// but not yet fully implemented (Payout / Promo methods / Agreement /
// Submit in P13.1 Slice 1; HandleBio is the one exception and ships
// as its own real form).
//
// P13.1 Slice 1 — Slice 2+ replaces each `<StepPlaceholder>` with the
// real step component (form fields + save server action).
//
// Why this is real UI (not a placeholder marker):
//   - Per AGENTS.md / QWEN.md we may NOT ship placeholder marker
//     comments in shipped code. Deferred work goes to STUBS.md with
//     a reason.
//   - The wizard advances end-to-end in Slice 1 to prove the URL
//     state machine + Stepper wiring work; each placeholder is a
//     fully designed step body (heading + description), just without
//     the form fields.
//   - Slice 2-3 swaps the placeholders one-by-one; no migration
//     needed for the shell.
//
// The continuation CTA already lives in the shell's `toolbar`
// (AffiliateOnboardingShell.tsx). This component owns ONLY the body
// text — when the real form lands it can wire its own actions
// without touching the shell.

import type { AffiliateOnboardingStep } from '../queries/getMyOnboardingDraft'
import styles from './StepPlaceholder.module.css'

export type StepPlaceholderProps = {
  stepId: AffiliateOnboardingStep
  stepOrdinal: number
  label: string
  description: string
}

/** A short, accurate description of what this step does in the
 *  wizard. Reads like a section heading rather than a "coming
 *  soon" disclaimer — the user is filling in real data, the form
 *  is the only piece still being built. */
const STEP_BLURB: Record<AffiliateOnboardingStep, string> = {
  welcome: '',
  handle_bio: '',
  payout:
    "Set the PayPal email where we'll send your weekly payouts. You can change this later from Settings.",
  promo_methods:
    'Pick the channels where you promote — Twitter, YouTube, a blog, an email list, or TikTok. Optional — you can leave everything blank and update it later.',
  agreement:
    'Confirm that you have read the Uthena Terms of Service and the Affiliate Terms.',
  submit:
    'Review everything you entered, then submit your application for admin review.',
}

export function StepPlaceholder({ stepId, stepOrdinal, label, description }: StepPlaceholderProps) {
  const blurb = STEP_BLURB[stepId]
  return (
    <div className={styles.wrap}>
      <p className={styles.eyebrow}>Step {stepOrdinal} of 6</p>
      <h2 className={styles.h2}>{label}</h2>
      <p className={styles.lede}>{description}</p>
      <p className={styles.blurb}>{blurb}</p>
      <p className={styles.note}>
        The form for this step is being built and will arrive in a follow-up release. Your
        progress is preserved — you can continue exploring the wizard and return later.
      </p>
    </div>
  )
}