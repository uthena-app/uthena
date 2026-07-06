// Barrel re-exports for the affiliate-onboarding feature. Pages
// import via `@features/affiliate-onboarding` so internal paths stay
// opaque + refactor-friendly.

export {
  getMyOnboardingDraft,
  ONBOARDING_STEPS,
  TOTAL_STEPS,
  FIRST_STEP,
  STEP_WELCOME,
  STEP_HANDLE_BIO,
  STEP_PAYOUT,
  STEP_PROMO_METHODS,
  STEP_AGREEMENT,
  STEP_SUBMIT,
  ALL_STEPS,
  EMPTY_STEP_PAYLOADS,
  type AffiliateOnboardingStep,
  type AffiliateOnboardingStepId,
  type AffiliateOnboardingDraft,
  type AffiliateOnboardingDraftResult,
} from './queries/getMyOnboardingDraft'

export {
  getMyAffiliateApplicationStatus,
  type AffiliateApplicationState,
} from './queries/getMyAffiliateApplicationStatus'

export {
  type ThanksApplicationState,
  getMyOnboardingApplicationForThanks,
} from './queries/getMyOnboardingApplicationForThanks'

export {
  parseRequestedStep,
  parseStepValue,
} from './lib/parseStep'

export {
  pageRateLimitVerdict,
  PAGE_VIEW_RATE_LIMIT_MAX_PER_USER,
  PAGE_VIEW_RATE_LIMIT_WINDOW_MS,
} from './lib/page-rate-limit'

export {
  HandleBioPayload,
  PayoutPayload,
  PromoMethodsPayload,
  AgreementPayload,
  SaveStepInput,
  payloadForStep,
  PAYLOAD_SCHEMAS,
  type SaveStepInputT,
  type SaveStepResult,
  type PromoMethod,
} from './lib/saveStepSchema'

export { saveStepAction } from './actions/saveStep'

export {
  AffiliateOnboardingShell,
  type AffiliateOnboardingShellProps,
} from './components/AffiliateOnboardingShell'

export { WelcomeStep } from './components/WelcomeStep'
export { HandleBioStep, type HandleBioStepProps } from './components/HandleBioStep'
export { PendingReview, type PendingReviewProps } from './components/PendingReview'
export { StepPlaceholder, type StepPlaceholderProps } from './components/StepPlaceholder'
export { ContinueButton, type ContinueButtonProps } from './components/ContinueButton'
export { WelcomePage, type WelcomePageProps } from './components/WelcomePage'
export { ThanksPage, type ThanksPageProps } from './components/ThanksPage'