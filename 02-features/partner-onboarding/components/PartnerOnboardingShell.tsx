// PartnerOnboardingShell — top-level wizard layout for /partner/onboarding.
//
// P12.1 Slice 1 — shell + step navigation surface.
// P12.2 — wired the Continue CTA to `saveStepAction` (persistence).
//
// What this owns:
//   - The 7-step Stepper (via the existing 00-foundations Stepper primitive)
//   - The per-step body section (Welcome / Profile / Payout / Tax / KYC /
//     Agreement / Submit)
//   - A consistent toolbar at the bottom: "Save & exit" + "Back" / "Continue"
//     buttons. Continue calls the saveStep server action and pushes the
//     next-step URL on success.
//
// What this does NOT own (intentionally, see spec):
//   - Per-step form validation (Slice 2+ adds the per-step forms; each
//     form also calls saveStep on submit so the persistence path is
//     consistent across the wizard)
//   - File uploads (Slice 2+ — Bunny signed PUT, ClamAV scan gate)
//   - Atomic submit (Slice 7)
//   - "Start over" (deferred — see STUB-089)
//
// URL contract (page.tsx enforces this; the shell reads from props):
//   /partner/onboarding                    → step = draft.currentStep or 1
//   /partner/onboarding?step=N             → step = N (within 1..7)
//   /partner/onboarding?step=N (invalid)   → step = draft.currentStep or 1
//
// All 6 steps ship as the right component — Welcome is fully written,
// steps 2-7 ship a `<StepPlaceholder>` (real UI, deferred work filed
// in STUBS.md per AGENTS.md rule 4) so the wizard advances
// end-to-end. Slice 2+ replaces each placeholder in place.

import Link from 'next/link'
import { Stepper } from '@foundations/ui/Stepper'
import {
  ONBOARDING_STEPS,
  ONBOARDING_TOTAL_STEPS,
  type OnboardingDraftResult,
} from '../queries/getMyOnboardingDraft'
import { ContinueButton } from './ContinueButton'
import { WelcomeStep } from './WelcomeStep'
import { StepPlaceholder } from './StepPlaceholder'
import styles from './PartnerOnboardingShell.module.css'

export type PartnerOnboardingShellProps = {
  /** The active step id (matches `ONBOARDING_STEPS[*].id`). */
  currentStep: number
  /** The user's draft (or `{ exists: false }`). Used to display a
   *  "Resume from..." hint in the header. */
  draft: OnboardingDraftResult
}

/** Map a 1-based step number to the corresponding ONBOARDING_STEPS entry
 *  id. Safe for any value (returns 'welcome' as the fallback). */
function stepIdFor(n: number): (typeof ONBOARDING_STEPS)[number]['id'] {
  const match = ONBOARDING_STEPS.find((s) => s.step === n)
  return match?.id ?? 'welcome'
}

export function PartnerOnboardingShell({ currentStep, draft }: PartnerOnboardingShellProps) {
  const currentStepId = stepIdFor(currentStep)
  const currentStepMeta = ONBOARDING_STEPS.find((s) => s.step === currentStep) ?? ONBOARDING_STEPS[0]!

  // Steps with `step <= currentStep - 1` are visually completed in the
  // stepper; the current step is `currentStep`; everything after is upcoming.
  const completedStepIds = ONBOARDING_STEPS
    .filter((s) => s.step < currentStep)
    .map((s) => s.id)

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Partner onboarding</p>
        <h1 className={styles.title}>Become a Uthena partner</h1>
        <p className={styles.lede}>
          {currentStepMeta.description} — we&apos;ll review your application within 2 business
          days.
        </p>
        {draft.exists && (
          <p className={styles.resume}>
            Saved{' '}
            <time dateTime={draft.updatedAt}>{new Date(draft.updatedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</time>
            {' '}— you can pick up where you left off.
          </p>
        )}
      </header>

      <nav aria-label="Onboarding progress" className={styles.stepper}>
        <Stepper
          steps={ONBOARDING_STEPS.map((s) => ({ id: s.id, label: s.label, description: s.description }))}
          currentStep={currentStepId}
          completedSteps={completedStepIds}
          ariaLabel="Onboarding progress"
        />
      </nav>

      <section className={styles.body} aria-live="polite">
        {currentStep === 1 ? (
          <WelcomeStep />
        ) : (
          <StepPlaceholder
            stepNumber={currentStep}
            stepId={currentStepId}
            label={currentStepMeta.label}
            description={currentStepMeta.description}
          />
        )}
      </section>

      <nav className={styles.toolbar} aria-label="Onboarding actions">
        <Link href="/library" className={styles.saveExit}>
          Save &amp; exit
        </Link>
        <div className={styles.nav}>
          {currentStep > 1 && (
            <Link href={stepHref(currentStep - 1)} className={styles.backLink}>
              ← Back
            </Link>
          )}
          {currentStep >= ONBOARDING_TOTAL_STEPS ? (
            // Final step (Submit) — atomic submit ships in Slice 7.
            // The CTA is intentionally disabled and reuses the
            // ContinueButton styling so the toolbar layout is stable
            // across slices.
            <ContinueButton step={currentStep} nextStep={currentStep} variant="final" disabled />
          ) : (
            <ContinueButton step={currentStep} nextStep={currentStep + 1} />
          )}
        </div>
      </nav>
    </div>
  )
}

/** Build the URL href for `?step=N` while preserving nothing else
 *  (the page only has one query param, `step`). */
function stepHref(n: number): string {
  return `/partner/onboarding?step=${n}`
}
