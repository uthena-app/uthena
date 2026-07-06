// getMyOnboardingApplicationForThanks — read the user's partner
// application for the `/partner/onboarding/thanks` route.
//
// P12.3 — the thanks page dispatches on three states:
//   1. No application (no `partners` row, OR a row but
//      `partner_onboarding_drafts.submitted_at IS NULL`) → redirect
//      to `/partner/onboarding/welcome` (the re-apply entry point).
//      This guards against a stuck session where the user clicked
//      "Submit" but the wizard never persisted the draft.
//   2. Pending application (`partners.status = 'pending'`, draft
//      submitted) → render the thanks surface.
//   3. Approved (`partners.status = 'approved'`) → redirect to
//      `/partner` (the dashboard).
//   4. Suspended (`partners.status = 'suspended'`) → redirect to
//      `/partner/onboarding/welcome` (re-apply entry point — per spec
//      acceptance criterion #3, treating 'suspended' as the
//      re-apply path; 'rejected' is not in the partner_status enum).
//
// Why a separate query from `getMyPartnerApplicationStatus`: the
// wizard's PendingReview surface already uses `created_at` as a
// `submittedAt` fallback, which is "good enough" for display. The
// thanks page needs the AUTHORITATIVE submitted timestamp from
// `partner_onboarding_drafts.submitted_at` (set by the submit
// server action) — if the draft wasn't submitted, redirect.
//
// Reads both `partners` AND `partner_onboarding_drafts` in parallel
// (`Promise.all` → 1 RT). RLS on both tables restricts to
// `user_id = auth.uid()`, so even a forged user object would
// 0-row. We never escalate to the service-role client here.
//
// PII-safe select: `id, status, created_at` from `partners` (no
// `payout_method`, no `tax_form_status`); `submitted_at` only from
// the draft.

import 'server-only'
import { getServerSupabase } from '@foundations/data/supabase'

export type ThanksApplicationState =
  /** No partner row, OR draft never submitted. The page should
   *  redirect to `/partner/onboarding/welcome`. */
  | { kind: 'none' }
  /** `partners.status = 'pending'` + `submitted_at IS NOT NULL`.
   *  The page renders the thanks surface. `partnerId` is shown as
   *  `#<id>` for support reference; `submittedAt` is the
   *  authoritative draft submit timestamp. */
  | { kind: 'pending'; partnerId: number; submittedAt: string }
  /** `partners.status = 'approved'` — page should redirect to
   *  `/partner`. `partnerId` carried for any logging that needs it. */
  | { kind: 'approved'; partnerId: number }
  /** `partners.status = 'suspended'` — page should redirect to
   *  `/partner/onboarding/welcome` (re-apply entry point). */
  | { kind: 'suspended'; partnerId: number }

const PARTNER_COLS = 'id, user_id, status, created_at'
const DRAFT_COLS = 'user_id, submitted_at'

export async function getMyOnboardingApplicationForThanks(): Promise<ThanksApplicationState> {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { kind: 'none' }

  // Two parallel reads — they're independent and both keyed by
  // user_id. RLS keeps both self-scoped.
  const [partnerResult, draftResult] = await Promise.all([
    supabase
      .from('partners')
      .select(PARTNER_COLS)
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase
      .from('partner_onboarding_drafts')
      .select(DRAFT_COLS)
      .eq('user_id', user.id)
      .maybeSingle(),
  ])

  const partnerRow = (partnerResult.data ?? null) as {
    id?: unknown
    status?: unknown
  } | null
  const draftRow = (draftResult.data ?? null) as {
    submitted_at?: unknown
  } | null

  // No partner row → no application.
  if (!partnerRow) return { kind: 'none' }

  const partnerId = typeof partnerRow.id === 'number' ? partnerRow.id : null
  if (partnerId === null) return { kind: 'none' }

  const submittedAt =
    draftRow && typeof draftRow.submitted_at === 'string'
      ? draftRow.submitted_at
      : null

  const status = partnerRow.status

  // Approved → redirect handled by the page.
  if (status === 'approved') {
    return { kind: 'approved', partnerId }
  }

  // Pending + draft submitted → render.
  // A pending row with NO submitted_at means the user has a partner
  // row but never completed submit — that's a stuck-state guard
  // (the page redirects to /welcome, not render). Possible only
  // if the partner row was created without the draft ever being
  // submitted (admin-side insert, or a future schema migration).
  if (status === 'pending' && submittedAt !== null) {
    return { kind: 'pending', partnerId, submittedAt }
  }

  // Suspended → re-apply entry point (treated like 'rejected' in the
  // spec acceptance criterion, but 'rejected' is not a valid
  // partner_status enum value today).
  if (status === 'suspended') {
    return { kind: 'suspended', partnerId }
  }

  // Anything else (defensive — unknown status string, pending
  // without submitted_at, etc.) → treat as "no application" so the
  // page redirects to /welcome. Never render a half-broken thanks.
  return { kind: 'none' }
}