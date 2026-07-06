'use client'

// ContinueButton — the "Continue" CTA on the affiliate-onboarding
// wizard's bottom toolbar (P13.1).
//
// P13.1 wires this CTA to the `saveStepAction` server action. On
// success it shows the spec-required "Progress saved" toast and
// navigates to the next step via `router.push()`. On error it
// surfaces a friendly inline error and stays on the current step.
//
// Why a client island (not a server-action form):
//   - The page itself is RSC; this CTA is one of the few places
//     that needs interactive orchestration (save → toast → push URL).
//   - We want optimistic "Progress saved" feedback inside the 300 ms
//     target — a no-JS `<form action=>` redirect would skip that.
//   - Future slices (2+) will replace the placeholder step bodies
//     with their own forms; each form calls saveStep on submit and
//     this CTA continues to work for the no-field Welcome step.

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@foundations/ui/primitives/Button'
import { useToast } from '@foundations/ui/Toast'
import { saveStepAction } from '../actions/saveStep'
import type { AffiliateOnboardingStep } from '../queries/getMyOnboardingDraft'
import styles from './ContinueButton.module.css'

export type ContinueButtonProps = {
  /** The step the user is currently on. The action saves this step;
   *  the router then advances to `nextStep`. */
  step: AffiliateOnboardingStep
  /** The next step to navigate to on save success. */
  nextStep: AffiliateOnboardingStep
  /** Optional payload to persist along with this step. Welcome (step 1)
   *  passes nothing; future slices pass their own Zod-validated form
   *  data here. Default: `undefined`. */
  payload?: Record<string, unknown>
  /** Visual variant. Pass `'final'` on the Submit step to render the
   *  "Submit application" CTA — Slice 2+ will replace it with the
   *  real submit flow. Until then this CTA stays disabled (see
   *  AffiliateOnboardingShell.tsx). */
  variant?: 'continue' | 'final'
  /** Disable the button (used by `<ContinueButton disabled>` while
   *  the parent is waiting for an external state). */
  disabled?: boolean
}

export function ContinueButton({
  step,
  nextStep,
  payload,
  variant = 'continue',
  disabled = false,
}: ContinueButtonProps) {
  const router = useRouter()
  const toast = useToast()
  const [isPending, startTransition] = useTransition()

  function handleClick() {
    if (disabled) return
    startTransition(async () => {
      const result = await saveStepAction({ step, payload })
      if (result.ok) {
        toast.success('Progress saved.')
        // Soft navigate so the wizard re-renders with the new
        // currentStep from the draft (and the URL reflects the step
        // the user actually arrived at).
        router.push(`/affiliate/onboarding?step=${nextStep}`)
      } else if (result.code === 'rate_limited') {
        toast.error(
          result.retryAfterSeconds
            ? `You're saving too quickly. Try again in ${result.retryAfterSeconds}s.`
            : "You're saving too quickly. Please wait a moment.",
        )
      } else if (result.code === 'unauthenticated') {
        toast.error('Please sign in again to continue.')
      } else if (result.code === 'handle_conflict') {
        toast.error(result.error)
      } else {
        toast.error(result.error)
      }
    })
  }

  const label =
    variant === 'final' ? (
      'Submit application — coming soon'
    ) : (
      <>
        Continue
        <span aria-hidden="true"> →</span>
      </>
    )

  return (
    <Button
      type="button"
      variant="primary"
      size="md"
      onClick={handleClick}
      disabled={disabled || isPending}
      aria-busy={isPending}
      className={styles.continueBtn}
    >
      {isPending ? 'Saving…' : label}
    </Button>
  )
}