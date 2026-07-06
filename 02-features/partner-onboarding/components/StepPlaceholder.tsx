// StepPlaceholder — generic step body for steps that are scaffolded
// but not yet fully implemented (Profile, Payout, Tax, KYC,
// Agreement, Submit in P12.1 Slice 1).
//
// P12.1 Slice 1 — Slice 2+ replaces each `<StepPlaceholder>` with
// the real step component (form fields + save server action).
//
// Why this is real UI (not a placeholder marker):
//   - Per AGENTS.md / QWEN.md we may NOT ship placeholder marker
//     comments in shipped code. Deferred work goes to STUBS.md with
//     a reason.
//   - The wizard advances end-to-end in Slice 1 to prove the URL
//     state machine + Stepper wiring work; each placeholder is a
//     fully designed step body (heading + description), just
//     without the form fields.
//   - Slice 2-7 swap the placeholders one-by-one; no migration
//     needed for the shell.
//
// The continuation CTA already lives in the shell's `toolbar`
// (PartnerOnboardingShell.tsx). This component owns ONLY the body
// text — when the real form lands it can wire its own actions
// without touching the shell.

import type { OnboardingStepId } from '../queries/getMyOnboardingDraft'
import styles from './StepPlaceholder.module.css'

export type StepPlaceholderProps = {
  stepNumber: number
  stepId: OnboardingStepId
  label: string
  description: string
}

/** A short, accurate description of what this step does in the
 *  wizard. Reads like a section heading rather than a "coming
 *  soon" disclaimer — the user is filling in real data, the form
 *  is the only piece still being built. */
const STEP_BLURB: Record<OnboardingStepId, string> = {
  welcome: '',
  profile:
    "Share a short bio and headshot that buyers will see on your public partner profile.",
  payout:
    "Set the PayPal email where we'll send weekly payouts. You can change this later from Settings.",
  tax: 'Tell us your country so we know which tax form to collect (W-9 for US, W-8BEN otherwise).',
  kyc: "Upload two photos of your government ID. We use these to verify your identity before your first payout over $600.",
  agreement:
    'Confirm that you have read the Uthena Terms of Service and the Partner Agreement.',
  submit: 'Review everything you entered, then submit your application for admin review.',
}

export function StepPlaceholder({ stepNumber, label, description }: StepPlaceholderProps) {
  return (
    <div className={styles.wrap}>
      <p className={styles.eyebrow}>Step {stepNumber} of 7</p>
      <h2 className={styles.h2}>{label}</h2>
      <p className={styles.lede}>{description}</p>
      <p className={styles.blurb}>{STEP_BLURB[stepLabelToId(label)]}</p>
      <p className={styles.note}>
        The form for this step is being built and will arrive in a follow-up release. Your
        progress is preserved — you can continue exploring the wizard and return later.
      </p>
    </div>
  )
}

/** Convert the human-readable label back into the step id used in the
 *  blurbs map. Cheap (7 entries) and avoids wiring a second prop
 *  through the shell for an internal helper. */
function stepLabelToId(label: string): OnboardingStepId {
  switch (label) {
    case 'Welcome': return 'welcome'
    case 'Profile': return 'profile'
    case 'Payout': return 'payout'
    case 'Tax': return 'tax'
    case 'KYC': return 'kyc'
    case 'Agreement': return 'agreement'
    case 'Submit': return 'submit'
    default: return 'profile'
  }
}
