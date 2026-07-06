// getMyPartnerApplicationStatus — branch logic for /partner/onboarding.
//
// P12.1 Slice 1 — landing-page routing.
//
// The wizard page has 4 distinct entry states:
//   1. anon → redirect to /signup?next=/partner/onboarding (handled by
//      `requireUser`, NOT this query)
//   2. logged in, has `partners.status = 'approved'` → redirect to /partner
//      (the dashboard)
//   3. logged in, has `partners.status = 'pending'` → render a
//      "Your application is being reviewed" state on the onboarding
//      page (per spec acceptance criterion line 65)
//   4. logged in, no partner row yet (the common case) → render the
//      wizard from step 1
//
// This query answers "what state are we in?" with the minimum DB hit.
// It selects only the columns the page needs and maps defensively.
//
// RLS on `partners` allows self-select; we never use the service-role
// client here. We select `id, user_id, status, public_slug` only —
// `bio`, `payout_method`, `tax_form_status`, etc. are out of scope.

import 'server-only'
import { getServerSupabase } from '@foundations/data/supabase'

export type PartnerApplicationState =
  /** No partner row yet — render the wizard from the user's `current_step`. */
  | { kind: 'none' }
  /** A partner row exists with `status = 'pending'` — render the
   *  "being reviewed" state. `submittedAt` is the draft's submit
   *  timestamp (or the partner row's created_at as a fallback). */
  | { kind: 'pending'; partnerId: number; submittedAt: string | null }
  /** A partner row exists with `status = 'approved'` — page should
   *  redirect to /partner (handled by the page itself). */
  | { kind: 'approved'; partnerId: number }
  /** A partner row exists with `status = 'suspended'` — render the
   *  wizard again so they can re-apply. (Per Open Question #3 — the
   *  spec recommends re-onboarding; ship the read shape, defer the
   *  write-side data-model change to STUB-088.) */
  | { kind: 'suspended'; partnerId: number }

const PARTNER_APP_COLS = 'id, user_id, status, created_at'

export async function getMyPartnerApplicationStatus(): Promise<PartnerApplicationState> {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { kind: 'none' }

  const { data, error } = await supabase
    .from('partners')
    .select(PARTNER_APP_COLS)
    .eq('user_id', user.id)
    .maybeSingle()

  if (error || !data) return { kind: 'none' }

  const row = data as {
    id?: unknown
    status?: unknown
    created_at?: unknown
  }

  const partnerId = typeof row.id === 'number' ? row.id : null
  const rawStatus = row.status
  const submittedAt =
    typeof row.created_at === 'string' ? row.created_at : null

  // Defensive — unknown status string maps to 'none' so a corrupt
  // row never blocks the wizard.
  if (rawStatus === 'pending' && partnerId !== null) {
    return { kind: 'pending', partnerId, submittedAt }
  }
  if (rawStatus === 'approved' && partnerId !== null) {
    return { kind: 'approved', partnerId }
  }
  if (rawStatus === 'suspended' && partnerId !== null) {
    return { kind: 'suspended', partnerId }
  }
  return { kind: 'none' }
}