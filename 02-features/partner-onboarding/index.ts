// partner-onboarding feature barrel.
//
// P12.1 Slice 1 — exports the read-side helpers + the shell,
// welcome, placeholder, and pending-review components.
// P12.2 — adds the saveStep server action + ContinueButton client
// island. Slice 3+ expands this barrel with the per-step form
// components; each re-uses saveStep on submit.
// P12.3 — adds the standalone welcome + thanks page components and
// the thanks-page query.

export {
  ONBOARDING_STEPS,
  ONBOARDING_TOTAL_STEPS,
  ONBOARDING_FIRST_STEP,
  type OnboardingDraft,
  type OnboardingDraftResult,
  type OnboardingStepId,
  getMyOnboardingDraft,
} from './queries/getMyOnboardingDraft'

export {
  type PartnerApplicationState,
  getMyPartnerApplicationStatus,
} from './queries/getMyPartnerApplicationStatus'

export {
  type ThanksApplicationState,
  getMyOnboardingApplicationForThanks,
} from './queries/getMyOnboardingApplicationForThanks'

export { PartnerOnboardingShell } from './components/PartnerOnboardingShell'
export { WelcomeStep } from './components/WelcomeStep'
export { StepPlaceholder } from './components/StepPlaceholder'
export { PendingReview } from './components/PendingReview'
export { ContinueButton } from './components/ContinueButton'
export { WelcomePage } from './components/WelcomePage'
export { ThanksPage } from './components/ThanksPage'

export { parseRequestedStep, parseStepValue } from './lib/parseStep'

// Page-level rate limit (used by /welcome and /thanks).
// Lives in a non-`'use server'` module so the page loader (RSC) can
// call it synchronously. Mirrors `saveStep.rate-limit.ts` (P12.2).
export {
  pageRateLimitVerdict,
  PAGE_VIEW_RATE_LIMIT_MAX_PER_USER,
  PAGE_VIEW_RATE_LIMIT_WINDOW_MS,
} from './lib/page-rate-limit'

// Pure schemas + result types live in `lib/saveStepSchema` so the
// `'use server'` action file can stay async-only (Next.js constraint).
export {
  type SaveStepInputT,
  type SaveStepResult,
  SaveStepInput,
  payloadForStep,
} from './lib/saveStepSchema'

// The server action itself re-exports from the actions/ folder.
export { saveStepAction } from './actions/saveStep'
