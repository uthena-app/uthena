// getMyOnboardingDraft — read the current user's partner onboarding draft.
//
// P12.1 Slice 1 — schema scaffolding + draft read.
//
// The `partner_onboarding_drafts` table is declared in migration 0001
// (line 1351) with columns: id, user_id (UNIQUE), payload jsonb,
// current_step int, submitted_at, created_at, updated_at. RLS gives
// the user self read/write and the admin self read.
//
// We read with `maybeSingle()` because the row is created lazily on
// the user's first step save — a brand-new visitor has no row yet
// and the page must render the wizard from step 1 anyway.
//
// Defensive: `payload` is `unknown` until we coerce it. We narrow it
// to `Record<string, unknown>` and never destructure past one level —
// any deeper shape is a step-specific contract owned by the step's
// server action (P12.1 Slice 2+). Keeping the read loose here means
// step payloads can evolve without touching this query.

import 'server-only'
import { getServerSupabase } from '@foundations/data/supabase'

/** Step number constants — 1-based, matching the wizard's
 *  `current_step` column. The order is the spec's canonical order
 *  (Welcome → Profile → Payout → Tax → KYC → Agreement → Submit). */
export const ONBOARDING_STEP_WELCOME = 1
export const ONBOARDING_STEP_PROFILE = 2
export const ONBOARDING_STEP_PAYOUT = 3
export const ONBOARDING_STEP_TAX = 4
export const ONBOARDING_STEP_KYC = 5
export const ONBOARDING_STEP_AGREEMENT = 6
export const ONBOARDING_STEP_SUBMIT = 7

export const ONBOARDING_TOTAL_STEPS = 7
export const ONBOARDING_FIRST_STEP = ONBOARDING_STEP_WELCOME

/**
 * The ordered step list with display labels + short descriptions.
 * The page renders this directly into the `<Stepper>`. Keeping it as
 * a const (not a function) lets the test assert the exact shape
 * without mocking anything.
 */
export const ONBOARDING_STEPS = [
  { id: 'welcome', step: ONBOARDING_STEP_WELCOME, label: 'Welcome', description: 'What to expect' },
  { id: 'profile', step: ONBOARDING_STEP_PROFILE, label: 'Profile', description: 'Bio + photo' },
  { id: 'payout', step: ONBOARDING_STEP_PAYOUT, label: 'Payout', description: 'PayPal email' },
  { id: 'tax', step: ONBOARDING_STEP_TAX, label: 'Tax', description: 'Country + form' },
  { id: 'kyc', step: ONBOARDING_STEP_KYC, label: 'KYC', description: 'ID upload' },
  { id: 'agreement', step: ONBOARDING_STEP_AGREEMENT, label: 'Agreement', description: 'TOS + DPA' },
  { id: 'submit', step: ONBOARDING_STEP_SUBMIT, label: 'Submit', description: 'Review + send' },
] as const

export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number]['id']

export type OnboardingDraft = {
  /** Always true when this object is returned — distinguishes "draft
   *  exists in DB" from "no draft yet, but the page should still
   *  render". The caller can branch on `exists` if it needs to. */
  exists: true
  currentStep: number
  payload: Record<string, unknown>
  submittedAt: string | null
  createdAt: string
  updatedAt: string
}

export type OnboardingDraftResult =
  | { exists: false }
  | OnboardingDraft

const DRAFT_COLS = 'id, user_id, payload, current_step, submitted_at, created_at, updated_at'

/** Read the current user's onboarding draft. Returns `{ exists: false }`
 *  for anon callers OR when the user has no draft yet (the row is
 *  created lazily on first step save). RLS on the table restricts
 *  read to `user_id = auth.uid()`, so even a forged user object
 *  would 0-row. */
export async function getMyOnboardingDraft(): Promise<OnboardingDraftResult> {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { exists: false }

  const { data, error } = await supabase
    .from('partner_onboarding_drafts')
    .select(DRAFT_COLS)
    .eq('user_id', user.id)
    .maybeSingle()

  if (error || !data) return { exists: false }

  // Defensive coercion — the columns are typed in the DB but
  // PostgREST's `unknown` / `jsonb` round-trip can serialize them
  // as anything. We narrow defensively rather than casting.
  const row = data as {
    current_step?: unknown
    payload?: unknown
    submitted_at?: unknown
    created_at?: unknown
    updated_at?: unknown
  }

  const currentStep = typeof row.current_step === 'number' && Number.isInteger(row.current_step)
    ? Math.max(ONBOARDING_FIRST_STEP, Math.min(ONBOARDING_TOTAL_STEPS, row.current_step))
    : ONBOARDING_FIRST_STEP

  const payload: Record<string, unknown> =
    row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
      ? (row.payload as Record<string, unknown>)
      : {}

  const submittedAt =
    typeof row.submitted_at === 'string' ? row.submitted_at : null
  const createdAt =
    typeof row.created_at === 'string' ? row.created_at : new Date(0).toISOString()
  const updatedAt =
    typeof row.updated_at === 'string' ? row.updated_at : createdAt

  return {
    exists: true,
    currentStep,
    payload,
    submittedAt,
    createdAt,
    updatedAt,
  }
}