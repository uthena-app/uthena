// getMyOnboardingDraft — read the current user's affiliate onboarding draft.
//
// P13.1 Slice 1 — schema scaffolding + draft read.
//
// The `affiliate_onboarding_drafts` table is declared in migration 0045
// with columns: id, user_id (UNIQUE), current_step (named enum:
// welcome | handle_bio | payout | promo_methods | agreement | submit),
// per-step jsonb columns (handle_bio / payout / promo_methods / agreement),
// affiliate_id (nullable back-link), submitted_at, created_at, updated_at.
// RLS gives the user self read/write and the admin self read.
//
// We read with `maybeSingle()` because the row is created lazily on
// the user's first step save — a brand-new visitor has no row yet and
// the page must render the wizard from step 1 anyway.
//
// Defensive: each jsonb column is `unknown` until we coerce it. We
// narrow to `Record<string, unknown>` per column and never destructure
// past one level — any deeper shape is a step-specific contract owned
// by the step's server action. Keeping the read loose here means step
// payloads can evolve without touching this query.

import 'server-only'
import { getServerSupabase } from '@foundations/data/supabase'

/** Named step constants — mirrors the `affiliate_onboarding_step` enum
 *  declared in migration 0045. The order is the spec's canonical order:
 *  Welcome → Handle & bio → Payout → Promo methods → Agreement → Submit.
 *  Using the named enum (not ints) keeps the URL `?step=` value, the
 *  DB `current_step` value, and the Stepper label in lock-step. */
export const STEP_WELCOME = 'welcome' as const
export const STEP_HANDLE_BIO = 'handle_bio' as const
export const STEP_PAYOUT = 'payout' as const
export const STEP_PROMO_METHODS = 'promo_methods' as const
export const STEP_AGREEMENT = 'agreement' as const
export const STEP_SUBMIT = 'submit' as const

export type AffiliateOnboardingStep =
  | typeof STEP_WELCOME
  | typeof STEP_HANDLE_BIO
  | typeof STEP_PAYOUT
  | typeof STEP_PROMO_METHODS
  | typeof STEP_AGREEMENT
  | typeof STEP_SUBMIT

/** The full ordered list of steps with display labels + short
 *  descriptions. The page renders this directly into the `<Stepper>`.
 *  Keeping it as a const (not a function) lets the test assert the
 *  exact shape without mocking anything. */
export const ONBOARDING_STEPS = [
  { id: STEP_WELCOME, label: 'Welcome', description: 'What to expect' },
  { id: STEP_HANDLE_BIO, label: 'Handle & bio', description: 'Your public URL' },
  { id: STEP_PAYOUT, label: 'Payout', description: 'PayPal email' },
  { id: STEP_PROMO_METHODS, label: 'Promo methods', description: 'Where you promote' },
  { id: STEP_AGREEMENT, label: 'Agreement', description: 'TOS + Affiliate Terms' },
  { id: STEP_SUBMIT, label: 'Submit', description: 'Review + send' },
] as const

export type AffiliateOnboardingStepId = (typeof ONBOARDING_STEPS)[number]['id']

export const TOTAL_STEPS = ONBOARDING_STEPS.length
export const FIRST_STEP: AffiliateOnboardingStep = STEP_WELCOME

/** The set of valid step values, exported for the Zod schema in
 *  `lib/saveStepSchema.ts` and the URL parser in `lib/parseStep.ts`. */
export const ALL_STEPS: ReadonlySet<AffiliateOnboardingStep> = new Set(
  ONBOARDING_STEPS.map((s) => s.id),
)

/** Default empty payloads for each step column. Used by the page when
 *  no draft row exists yet (the row is created lazily on first save),
 *  so the form fields always render with explicit defaults instead of
 *  `undefined`. */
export const EMPTY_STEP_PAYLOADS = {
  handle_bio: {} as Record<string, unknown>,
  payout: {} as Record<string, unknown>,
  promo_methods: {} as Record<string, unknown>,
  agreement: {} as Record<string, unknown>,
} as const

export type AffiliateOnboardingDraft = {
  /** Always true when this object is returned — distinguishes "draft
   *  exists in DB" from "no draft yet, but the page should still
   *  render". The caller can branch on `exists` if it needs to. */
  exists: true
  currentStep: AffiliateOnboardingStep
  handleBio: Record<string, unknown>
  payout: Record<string, unknown>
  promoMethods: Record<string, unknown>
  agreement: Record<string, unknown>
  submittedAt: string | null
  createdAt: string
  updatedAt: string
}

export type AffiliateOnboardingDraftResult =
  | { exists: false }
  | AffiliateOnboardingDraft

const DRAFT_COLS =
  'id, user_id, current_step, handle_bio, payout, promo_methods, agreement, submitted_at, created_at, updated_at'

/** Defensive narrowing — coerce an unknown jsonb value to a plain
 *  Record. Returns `{}` for null / array / non-object inputs (the
 *  per-step payloads are always objects; arrays / scalars are
 *  treated as corruption and replaced with `{}` so the form
 *  renders clean defaults instead of throwing). */
function narrowJsonbObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

/** Defensive narrowing for the named step enum. Returns FIRST_STEP
 *  on unknown / null / non-string input so a corrupt row never
 *  blocks the wizard. */
function narrowStep(raw: unknown): AffiliateOnboardingStep {
  if (typeof raw === 'string' && ALL_STEPS.has(raw as AffiliateOnboardingStep)) {
    return raw as AffiliateOnboardingStep
  }
  return FIRST_STEP
}

/** Read the current user's affiliate onboarding draft. Returns
 *  `{ exists: false }` for anon callers OR when the user has no
 *  draft yet (the row is created lazily on first step save). RLS
 *  on the table restricts read to `user_id = auth.uid()`, so even
 *  a forged user object would 0-row. */
export async function getMyOnboardingDraft(): Promise<AffiliateOnboardingDraftResult> {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { exists: false }

  const { data, error } = await supabase
    .from('affiliate_onboarding_drafts')
    .select(DRAFT_COLS)
    .eq('user_id', user.id)
    .maybeSingle()

  if (error || !data) return { exists: false }

  // Defensive coercion — the columns are typed in the DB but
  // PostgREST's `unknown` / `jsonb` round-trip can serialize them
  // as anything. We narrow defensively rather than casting.
  const row = data as {
    current_step?: unknown
    handle_bio?: unknown
    payout?: unknown
    promo_methods?: unknown
    agreement?: unknown
    submitted_at?: unknown
    created_at?: unknown
    updated_at?: unknown
  }

  const createdAt =
    typeof row.created_at === 'string' ? row.created_at : new Date(0).toISOString()
  const updatedAt =
    typeof row.updated_at === 'string' ? row.updated_at : createdAt

  return {
    exists: true,
    currentStep: narrowStep(row.current_step),
    handleBio: narrowJsonbObject(row.handle_bio),
    payout: narrowJsonbObject(row.payout),
    promoMethods: narrowJsonbObject(row.promo_methods),
    agreement: narrowJsonbObject(row.agreement),
    submittedAt:
      typeof row.submitted_at === 'string' ? row.submitted_at : null,
    createdAt,
    updatedAt,
  }
}