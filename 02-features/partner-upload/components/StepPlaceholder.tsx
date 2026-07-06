// StepPlaceholder — generic step body for wizard steps that are
// scaffolded but not yet fully implemented (Curriculum, Files,
// Pricing, Review in P12.7 Slice 1).
//
// P12.7 Slice 1 — Slices 2-5 replace each `<StepPlaceholder>` with
// the real step component (form fields + save server action +
// per-step validation).
//
// Why this is real UI (not a placeholder marker):
//   - Per AGENTS.md / QWEN.md we may NOT ship placeholder marker
//     comments in shipped code. Deferred work goes to STUBS.md with
//     a reason.
//   - The wizard advances end-to-end in Slice 1 to prove the URL
//     state machine + Stepper wiring work; each placeholder is a
//     fully designed step body (heading + description + blurb), just
//     without the form fields.
//   - Slices 2-5 swap the placeholders one-by-one; no migration
//     needed for the shell.
//
// The continuation CTA already lives in the shell's `toolbar`
// (UploadShell.tsx). This component owns ONLY the body text — when
// the real form lands it can wire its own actions without touching
// the shell.

import type { UploadStepId } from '../queries/getMyUploadDraft'
import styles from './StepPlaceholder.module.css'

export type StepPlaceholderProps = {
  stepNumber: number
  stepId: UploadStepId
  label: string
  description: string
}

/** A short, accurate description of what this step does in the
 *  wizard. Reads like a section heading rather than a "coming
 *  soon" disclaimer — the user is going to fill in real data, the
 *  form is the only piece still being built. */
const STEP_BLURB: Record<UploadStepId, string> = {
  details: '',
  curriculum:
    "Break the course into modules and lessons. Buyers will see this list on your product page.",
  files:
    "Drag-and-drop your video, source files, and sales materials. We'll scan uploads for malware before they go live.",
  pricing:
    'Pick which license tiers you offer (Whitelabel, PLR, PLR+MRR) and set a price for each. PLR is required.',
  review:
    "Take a final look at your listing before submitting it for admin review. We'll email you within 48 hours.",
}

export function StepPlaceholder({ stepNumber, label, description }: StepPlaceholderProps) {
  return (
    <div className={styles.wrap}>
      <p className={styles.eyebrow}>Step {stepNumber} of 5</p>
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
 *  blurbs map. Cheap (5 entries) and avoids wiring a second prop
 *  through the shell for an internal helper. */
function stepLabelToId(label: string): UploadStepId {
  switch (label) {
    case 'Details': return 'details'
    case 'Curriculum': return 'curriculum'
    case 'Files': return 'files'
    case 'Pricing': return 'pricing'
    case 'Review': return 'review'
    default: return 'details'
  }
}
