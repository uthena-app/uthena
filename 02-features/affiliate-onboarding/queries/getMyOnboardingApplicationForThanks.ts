// getMyOnboardingApplicationForThanks — read the user's affiliate
// application for the `/affiliate/onboarding/thanks` route.
//
// P13.2 — the thanks page dispatches on three states:
//   1. No application (no `affiliates` row, OR a row but
//      `affiliate_onboarding_drafts.submitted_at IS NULL`) → redirect
//      to `/affiliate/onboarding/welcome` (the re-apply entry point).
//      This guards against a stuck session where the user clicked
//      "Submit" but the wizard never persisted the draft.
//   2. Pending application (`affiliates.status = 'pending'`, draft
//      submitted) → render the thanks surface.
//   3. Approved (`affiliates.status = 'approved'`) → redirect to
//      `/affiliate` (the dashboard).
//   4. Suspended (`affiliates.status = 'suspended'`) → redirect to
//      `/affiliate/onboarding/welcome` (re-apply entry point — per
//      spec acceptance criterion #3, treating 'suspended' as the
//      re-apply path).
//
// Why a separate query from `getMyAffiliateApplicationStatus`: the
// wizard's PendingReview surface already uses `created_at` as a
// `submittedAt` fallback, which is "good enough" for display. The
// thanks page needs the AUTHORITATIVE submitted timestamp from
// `affiliate_onboarding_drafts.submitted_at` (set by the submit
// server action) — if the draft wasn't submitted, redirect.
//
// Reads both `affiliates` AND `affiliate_onboarding_drafts` in parallel
// (`Promise.all` → 1 RT). RLS on both tables restricts to
// `user_id = auth.uid()`, so even a forged user object would
// 0-row. We never escalate to the service-role client here.
//
// PII-safe select: `id, user_id, status, created_at` from `affiliates`
// (no `payout_method`, no `bio`); `submitted_at` only from the draft.

import 'server-only'
import { getServerSupabase } from '@foundations/data/supabase'

export type ThanksApplicationState =
  /** No affiliate row, OR draft never submitted. The page should
   *  redirect to `/affiliate/onboarding/welcome`. */
  | { kind: 'none' }
  /** `affiliates.status = 'pending'` + `submitted_at IS NOT NULL`.
   *  The page renders the thanks surface. `affiliateId` is shown as
   *  `#<id>` for support reference; `submittedAt` is the
   *  authoritative draft submit timestamp. */
  | { kind: 'pending'; affiliateId: number; submittedAt: string }
  /** `affiliates.status = 'approved'` — page should redirect to
   *  `/affiliate`. `affiliateId` carried for any logging that needs it. */
  | { kind: 'approved'; affiliateId: number }
  /** `affiliates.status = 'suspended'` — page should redirect to
   *  `/affiliate/onboarding/welcome` (re-apply entry point). */
  | { kind: 'suspended'; affiliateId: number }

const AFFILIATE_COLS = 'id, user_id, status, created_at'
const DRAFT_COLS = 'user_id, submitted_at'

export async function getMyOnboardingApplicationForThanks(): Promise<ThanksApplicationState> {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { kind: 'none' }

  // Two parallel reads — they're independent and both keyed by
  // user_id. RLS keeps both self-scoped.
  const [affiliateResult, draftResult] = await Promise.all([
    supabase
      .from('affiliates')
      .select(AFFILIATE_COLS)
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase
      .from('affiliate_onboarding_drafts')
      .select(DRAFT_COLS)
      .eq('user_id', user.id)
      .maybeSingle(),
  ])

  const affiliateRow = (affiliateResult.data ?? null) as {
    id?: unknown
    status?: unknown
  } | null
  const draftRow = (draftResult.data ?? null) as {
    submitted_at?: unknown
  } | null

  // No affiliate row → no application.
  if (!affiliateRow) return { kind: 'none' }

  const affiliateId =
    typeof affiliateRow.id === 'number' ? affiliateRow.id : null
  if (affiliateId === null) return { kind: 'none' }

  const submittedAt =
    draftRow && typeof draftRow.submitted_at === 'string'
      ? draftRow.submitted_at
      : null

  const status = affiliateRow.status

  // Approved → redirect handled by the page.
  if (status === 'approved') {
    return { kind: 'approved', affiliateId }
  }

  // Pending + draft submitted → render.
  // A pending row with NO submitted_at means the user has an
  // affiliate row but never completed submit — that's a stuck-state
  // guard (the page redirects to /welcome, not render).
  if (status === 'pending' && submittedAt !== null) {
    return { kind: 'pending', affiliateId, submittedAt }
  }

  // Suspended → re-apply entry point.
  if (status === 'suspended') {
    return { kind: 'suspended', affiliateId }
  }

  // Anything else (defensive — unknown status string, pending
  // without submitted_at, etc.) → treat as "no application" so the
  // page redirects to /welcome. Never render a half-broken thanks.
  return { kind: 'none' }
}