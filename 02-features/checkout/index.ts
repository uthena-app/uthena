// Public surface of the checkout feature.

export { getOrderForConfirmation, type OrderForConfirmation } from './queries/getOrderForConfirmation'

export { createCheckoutSessionAction, type CreateCheckoutResult } from './actions/createCheckoutSession'
export { onPaymentSucceeded, type OnPaymentSucceededResult } from './actions/onPaymentSucceeded'
export { onRefund } from './actions/onRefund'
export { onPaymentFailed, type OnPaymentFailedResult, type StripePaymentFailedLike } from './actions/onPaymentFailed'
export { onDisputeCreated, onDisputeClosed, type OnDisputeResult } from './actions/onDispute'

export { OrderSummary } from './components/OrderSummary'
export { PollLibraryReady } from './components/PollLibraryReady'
export { CheckoutErrorBanner } from './components/CheckoutErrorBanner'

// P4.7 — multi-step wizard. The wizard is URL-driven via `?step=`,
// and renders Email + Review locally. Payment (Stripe-hosted redirect)
// and Confirmation (/checkout/success) live outside the wizard.
export {
  CheckoutWizard,
  type CheckoutWizardProps,
} from './components/CheckoutWizard'
export { CheckoutStepper, CHECKOUT_STEPPER_STEPS, LOCAL_STEPS } from './components/CheckoutStepper'
export { EmailStep, type EmailStepProps } from './components/EmailStep'
export { ReviewStep, type ReviewStepProps } from './components/ReviewStep'
export { PayButton } from './components/PayButton'
export {
  parseCheckoutStep,
  checkoutStepHref,
  CHECKOUT_STEPS,
  type CheckoutStepId,
  type ParsedCheckoutStep,
} from './components/parseCheckoutStep'

export { formatOrderDate, LICENSE_SHORT } from './format'
