// CheckoutStepper.tsx — the canonical 4-step list for /checkout.
// RSC. Wraps the shared Stepper primitive with the fixed step ids +
// labels the checkout surface owns. Keeping this in one place means
// the wizard's "what are the steps?" answer is the same in every
// surface (the wizard body, the README, the spec, the testing docs).
//
// Steps:
//   1. Email       — confirm receipt address + name
//   2. Review      — items + coupon + legal links
//   3. Payment     — happens on Stripe Checkout (hosted)
//   4. Confirmation — /checkout/success?order=…
//
// Payment is intentionally not a local RSC step — the redirect to
// Stripe leaves our domain, and the success page already owns
// confirmation. The wizard's URL param only exposes the local steps
// (email | review) — see parseCheckoutStep.

import { Stepper, type StepperStep } from '@foundations/ui/Stepper'
import { CHECKOUT_STEPS, type CheckoutStepId } from './parseCheckoutStep'

export const CHECKOUT_STEPPER_STEPS: readonly StepperStep[] = [
  { id: 'email', label: 'Email', description: 'Receipt + library access' },
  { id: 'review', label: 'Review', description: 'Items + total' },
  { id: 'payment', label: 'Payment', description: 'Secure via Stripe' },
  { id: 'confirmation', label: 'Done' },
] as const

/**
 * The "local" step ids the wizard can show. Payment + Confirmation
 * happen on Stripe's domain and /checkout/success respectively — the
 * wizard itself only renders email + review.
 */
export const LOCAL_STEPS: readonly CheckoutStepId[] = ['email', 'review'] as const

export function CheckoutStepper({ currentStep }: { currentStep: CheckoutStepId }) {
  // `payment` and `confirmation` are outside the local wizard, but
  // they still belong in the visible progress. If the user is on
  // the review step, we mark payment as "upcoming" (it will turn
  // "done" on success page navigation). The completedSteps helper
  // makes sure all steps before `currentStep` show as done.
  const currentIndex = CHECKOUT_STEPS.indexOf(currentStep)
  return (
    <Stepper
      steps={CHECKOUT_STEPPER_STEPS}
      currentStep={currentStep}
      completedSteps={currentIndex > 0 ? CHECKOUT_STEPPER_STEPS.slice(0, currentIndex).map((s) => s.id) : []}
      ariaLabel="Checkout progress"
    />
  )
}