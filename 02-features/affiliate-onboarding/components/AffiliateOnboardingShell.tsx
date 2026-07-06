// AffiliateOnboardingShell — top-level wizard layout for
// /affiliate/onboarding.
//
// P13.1 Slice 1 — shell + step navigation surface. The shell
// orchestrates the wizard's chrome (header + stepper + body + toolbar)
// and delegates per-step body to the matching component. Per-step
// forms own their own `saveStep` action call (matching the partner
// onboarding pattern).
//
// What ships in Slice 1:
//   - The 6-step Stepper (via the existing 00-foundations Stepper
//     primitive)
//   - The per-step body section (Welcome / Handle & bio / Payout /
//     Promo methods / Agreement / Submit)
//   - Toolbar: "Save & exit" + Back / Continue CTAs (Continue calls
//     `saveStepAction` and pushes the next-step URL on success).
//
// What ships deferred (filed in STUBS.md per AGENTS.md rule 4):
//   - Per-step form fields for steps 3-6 (Payout / Promo methods /
//     Agreement / Submit) — Slice 2+ adds each form
//   - Avatar upload at step 2 (Bunny signed PUT) — Slice 2+
//   - Atomic submit at step 6 (creates the affiliates row,
//     transfers the handle reservation, queues 2 emails) — Slice 2+
//
// URL contract (page.tsx enforces this; the shell reads from props):
//   /affiliate/onboarding                    → step = draft.currentStep or 'welcome'
//   /affiliate/onboarding?step=<name>        → step = <name> (within the enum)
//   /affiliate/onboarding?step=<name> (bad)  → step = draft.currentStep or 'welcome'

import Link from 'next/link'
import { Stepper } from '@foundations/ui/Stepper'
import {
  ONBOARDING_STEPS,
  TOTAL_STEPS,
  type AffiliateOnboardingDraftResult,
  type AffiliateOnboardingStep,
} from '../queries/getMyOnboardingDraft'
import { ContinueButton } from './ContinueButton'
import { WelcomeStep } from './WelcomeStep'
import { HandleBioStep } from './HandleBioStep'
import { StepPlaceholder } from './StepPlaceholder'
import styles from './AffiliateOnboardingShell.module.css'

export type AffiliateOnboardingShellProps = {
  /** The active step id (matches `ONBOARDING_STEPS[*].id`). */
  currentStep: AffiliateOnboardingStep
  /** The user's draft (or `{ exists: false }`). Used to display a
   *  "Resume from..." hint in the header + to pre-fill step forms. */
  draft: AffiliateOnboardingDraftResult
}

/** The 1-based ordinal for a given step id. Used by the Stepper's
 *  "current step" indicator (the foundation Stepper accepts a string
 *  id). */
function stepOrdinal(step: AffiliateOnboardingStep): number {
  return ONBOARDING_STEPS.findIndex((s) => s.id === step) + 1
}

export function AffiliateOnboardingShell({ currentStep, draft }: AffiliateOnboardingShellProps) {
  const ordinal = stepOrdinal(currentStep)
  const stepMeta = ONBOARDING_STEPS.find((s) => s.id === currentStep) ?? ONBOARDING_STEPS[0]!

  // Steps BEFORE the current one are visually completed in the stepper.
  const completedStepIds = ONBOARDING_STEPS
    .filter((s) => stepOrdinal(s.id) < ordinal)
    .map((s) => s.id)

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Affiliate onboarding</p>
        <h1 className={styles.title}>Become a Uthena affiliate</h1>
        <p className={styles.lede}>
          {stepMeta.description} — earn 20% commission on every sale for 30 days after the click.
        </p>
        {draft.exists && (
          <p className={styles.resume}>
            Saved{' '}
            <time dateTime={draft.updatedAt}>
              {new Date(draft.updatedAt).toLocaleString('en-US', {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
            </time>
            {' '}— you can pick up where you left off.
          </p>
        )}
      </header>

      <nav aria-label="Onboarding progress" className={styles.stepper}>
        <Stepper
          steps={ONBOARDING_STEPS.map((s) => ({
            id: s.id,
            label: s.label,
            description: s.description,
          }))}
          currentStep={currentStep}
          completedSteps={completedStepIds}
          ariaLabel="Onboarding progress"
        />
      </nav>

      <section className={styles.body} aria-live="polite">
        {currentStep === 'welcome' ? (
          <WelcomeStep />
        ) : currentStep === 'handle_bio' ? (
          <HandleBioStep draft={draft} />
        ) : (
          <StepPlaceholder
            stepId={currentStep}
            stepOrdinal={ordinal}
            label={stepMeta.label}
            description={stepMeta.description}
          />
        )}
      </section>

      <nav className={styles.toolbar} aria-label="Onboarding actions">
        <Link href="/library" className={styles.saveExit}>
          Save &amp; exit
        </Link>
        <div className={styles.nav}>
          {ordinal > 1 && (
            <Link href={stepHref(ONBOARDING_STEPS[ordinal - 2]!.id)} className={styles.backLink}>
              ← Back
            </Link>
          )}
          {ordinal >= TOTAL_STEPS ? (
            // Final step (Submit) — atomic submit ships in Slice 2+.
            // The CTA is intentionally disabled and reuses the
            // ContinueButton styling so the toolbar layout is stable
            // across slices.
            <ContinueButton
              step={currentStep}
              nextStep={currentStep}
              variant="final"
              disabled
            />
          ) : (
            <ContinueButton
              step={currentStep}
              nextStep={ONBOARDING_STEPS[ordinal]!.id}
            />
          )}
        </div>
      </nav>
    </div>
  )
}

/** Build the URL href for `?step=<name>` (the only query param the
 *  page reads). */
function stepHref(step: AffiliateOnboardingStep): string {
  return `/affiliate/onboarding?step=${step}`
}