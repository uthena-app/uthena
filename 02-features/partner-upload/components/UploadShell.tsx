// UploadShell — top-level wizard layout for /partner/upload.
//
// P12.7 Slice 1 — shell + step navigation surface.
//
// What this owns:
//   - The 5-step Stepper (via the existing 00-foundations Stepper primitive)
//   - The per-step body section (Details / Curriculum / Files / Pricing / Review)
//   - A consistent toolbar at the bottom: "Save & exit" + "Back" /
//     "Continue" buttons. The Continue CTA calls saveUploadDraft and
//     pushes the next-step URL on success.
//
// What this does NOT own (intentionally, see spec):
//   - Per-step form validation beyond Step 1 (Slices 2-5 add the
//     per-step forms; each form also calls saveUploadDraft on submit
//     so the persistence path is consistent across the wizard)
//   - File uploads (Slices 2-3 — Bunny signed PUT, ClamAV scan gate)
//   - Atomic submit (Slice 5)
//   - "Save & exit" deferred to STUB-094 alongside the dashboard
//     "My drafts" widget
//
// URL contract (page.tsx enforces this; the shell reads from props):
//   /partner/upload                    → step = draft.currentStep or 1
//   /partner/upload?step=N             → step = N (within 1..5)
//   /partner/upload?step=N (invalid)   → step = draft.currentStep or 1
//
// Step 1 (Details) is fully written; steps 2-5 ship a `<StepPlaceholder>`
// (real UI, deferred work filed in STUBS.md per AGENTS.md rule 4) so
// the wizard advances end-to-end. Slices 2-5 replace each placeholder
// in place.

import Link from 'next/link'
import { Stepper } from '@foundations/ui/Stepper'
import {
  UPLOAD_STEPS,
  type UploadDraftResult,
} from '../queries/getMyUploadDraft'
import { DetailsStep } from './DetailsStep'
import { CurriculumStep } from './CurriculumStep'
import { StepPlaceholder } from './StepPlaceholder'
import type { CategoryOption } from '@features/partner-portal/queries/listPartnerCategories'
import styles from './UploadShell.module.css'

export type UploadShellProps = {
  /** The active step id (matches `UPLOAD_STEPS[*].id`). */
  currentStep: number
  /** The user's draft (or `{ exists: false }`). Used to display a
   *  "Resume from..." hint in the header + hydrate the form fields. */
  draft: UploadDraftResult
  /** Categories for the Step 1 category dropdown. Empty array is safe
   *  — the form renders a friendly empty state in that case. */
  categories: readonly CategoryOption[]
}

/** Map a 1-based step number to the corresponding UPLOAD_STEPS entry
 *  id. Safe for any value (returns 'details' as the fallback). */
function stepIdFor(n: number): (typeof UPLOAD_STEPS)[number]['id'] {
  const match = UPLOAD_STEPS.find((s) => s.step === n)
  return match?.id ?? 'details'
}

export function UploadShell({ currentStep, draft, categories }: UploadShellProps) {
  const currentStepId = stepIdFor(currentStep)
  const currentStepMeta =
    UPLOAD_STEPS.find((s) => s.step === currentStep) ?? UPLOAD_STEPS[0]!

  // Steps with `step <= currentStep - 1` are visually completed in the
  // stepper; the current step is `currentStep`; everything after is upcoming.
  const completedStepIds = UPLOAD_STEPS.filter((s) => s.step < currentStep).map((s) => s.id)

  // Last-saved indicator — the spec's right-rail "Saved N seconds ago".
  // Reads `lastSavedStep` (the step the partner most recently touched)
  // + `updatedAt` (when they touched it).
  const lastSaved =
    draft.exists
      ? {
          step: draft.lastSavedStep,
          at: draft.updatedAt,
        }
      : null

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Partner upload</p>
        <h1 className={styles.title}>Create a new course</h1>
        <p className={styles.lede}>
          {currentStepMeta.description} — your draft auto-saves as you type.
        </p>
        {lastSaved && (
          <p className={styles.resume}>
            Last saved at step {lastSaved.step}{' '}
            <time dateTime={lastSaved.at}>
              ({new Date(lastSaved.at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })})
            </time>
            {' '}— you can pick up where you left off.
          </p>
        )}
      </header>

      <nav aria-label="Upload progress" className={styles.stepper}>
        <Stepper
          steps={UPLOAD_STEPS.map((s) => ({ id: s.id, label: s.label, description: s.description }))}
          currentStep={currentStepId}
          completedSteps={completedStepIds}
          ariaLabel="Upload progress"
        />
      </nav>

      <section className={styles.body} aria-live="polite">
        {currentStep === 1 ? (
          <DetailsStep draft={draft} categories={categories} />
        ) : currentStep === 2 ? (
          <CurriculumStep draft={draft} />
        ) : (
          <StepPlaceholder
            stepNumber={currentStep}
            stepId={currentStepId}
            label={currentStepMeta.label}
            description={currentStepMeta.description}
          />
        )}
      </section>

      <nav className={styles.toolbar} aria-label="Upload actions">
        <Link href="/partner/courses" className={styles.saveExit}>
          Save &amp; exit
        </Link>
        <div className={styles.nav}>
          {currentStep > 1 && (
            <Link href={stepHref(currentStep - 1)} className={styles.backLink}>
              ← Back
            </Link>
          )}
          {currentStep < UPLOAD_STEPS.length ? (
            <Link href={stepHref(currentStep + 1)} className={styles.continueLink}>
              Continue <span aria-hidden="true">→</span>
            </Link>
          ) : (
            // Final step (Review) — atomic submit ships in Slice 5.
            // The CTA is intentionally disabled to keep the toolbar
            // layout stable across slices; Slice 5 wires it to the
            // real submit-for-review action.
            <span className={styles.continueLinkDisabled} aria-disabled="true">
              Submit for review — coming soon
            </span>
          )}
        </div>
      </nav>
    </div>
  )
}

/** Build the URL href for `?step=N` while preserving nothing else
 *  (the page only has one query param, `step`). */
function stepHref(n: number): string {
  return `/partner/upload?step=${n}`
}
