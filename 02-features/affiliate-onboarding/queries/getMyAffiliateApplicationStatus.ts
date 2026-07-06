// getMyAffiliateApplicationStatus — branch logic for
// /affiliate/onboarding.
//
// P13.1 Slice 1 — landing-page routing.
//
// The wizard page has 4 distinct entry states (mirrors the partner
// onboarding page):
//   1. anon → redirect to /signup?next=/affiliate/onboarding (handled
//      by `requireUser`, NOT this query).
//   2. logged in, has `affiliates.status = 'approved'` → redirect to
//      /affiliate (the dashboard).
//   3. logged in, has `affiliates.status = 'pending'` → render a
//      "Your application is being reviewed" state on the onboarding
//      page (per spec acceptance criterion line 31).
//   4. logged in, no affiliate row yet (the common case) → render the
//      wizard from step 1.
//
// Difference from the partner variant: `suspended` affiliates see
// the wizard again so they can re-apply. The spec is silent on the
// suspended-reapply data-model flow (the `affiliates.user_id` UNIQUE
// blocks re-submit today); that's a Slice 2+ problem.
//
// This query answers "what state are we in?" with the minimum DB hit.
// It selects only the columns the page needs and maps defensively.
//
// RLS on `affiliates` allows self-select; we never use the service-role
// client here. We select `id, user_id, status, created_at` only —
// `bio`, `payout_method`, `handle`, etc. are out of scope.

import 'server-only'
import { getServerSupabase } from '@foundations/data/supabase'

export type AffiliateApplicationState =
  /** No affiliate row yet — render the wizard from the draft's
   *  `currentStep` (or step 1 when no draft exists either). */
  | { kind: 'none' }
  /** An affiliate row exists with `status = 'pending'` — render the
   *  "being reviewed" state. `submittedAt` is the draft's submit
   *  timestamp (or the affiliate row's created_at as a fallback). */
  | { kind: 'pending'; affiliateId: number; submittedAt: string | null }
  /** An affiliate row exists with `status = 'approved'` — page
   *  should redirect to /affiliate (handled by the page itself). */
  | { kind: 'approved'; affiliateId: number }
  /** An affiliate row exists with `status = 'suspended'` — render
   *  the wizard again so they can re-apply. (The re-apply flow's
   *  data-model shape lands in Slice 2+.) */
  | { kind: 'suspended'; affiliateId: number }

const AFFILIATE_APP_COLS = 'id, user_id, status, created_at'

export async function getMyAffiliateApplicationStatus(): Promise<AffiliateApplicationState> {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { kind: 'none' }

  const { data, error } = await supabase
    .from('affiliates')
    .select(AFFILIATE_APP_COLS)
    .eq('user_id', user.id)
    .maybeSingle()

  if (error || !data) return { kind: 'none' }

  const row = data as {
    id?: unknown
    status?: unknown
    created_at?: unknown
  }

  const affiliateId = typeof row.id === 'number' ? row.id : null
  const rawStatus = row.status
  const submittedAt =
    typeof row.created_at === 'string' ? row.created_at : null

  // Defensive — unknown status string maps to 'none' so a corrupt
  // row never blocks the wizard.
  if (rawStatus === 'pending' && affiliateId !== null) {
    return { kind: 'pending', affiliateId, submittedAt }
  }
  if (rawStatus === 'approved' && affiliateId !== null) {
    return { kind: 'approved', affiliateId }
  }
  if (rawStatus === 'suspended' && affiliateId !== null) {
    return { kind: 'suspended', affiliateId }
  }
  return { kind: 'none' }
}