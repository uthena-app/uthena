// getPendingPayoutRequest.ts — partner's most-recent pending payout
// request, if any.
//
// P6.6 — the `/partner/payouts` page renders a "Request payout"
// affordance. The affordance must respect the partner's existing
// pending request (if any) so we don't show the button twice and
// confuse the partner into thinking they need to click it again.
//
// The partner's RLS on `payout_requests`
// (`payout_requests_partner_read_own`) limits the read to their own
// rows — we use the user's session client, not service-role.
//
// Returns null when:
//   - no session user
//   - no partner row (race during onboarding)
//   - no pending request
//
// Returns the most-recent pending row (created_at desc, id desc) —
// in practice a partner should only have ONE pending row at a time
// (the action enforces this via the existing-pending check), but
// we read newest-first defensively in case an admin action surfaced
// multiple. Returns null on DB error (fail-soft; the page renders
// as if there's no pending request — clicking the button will
// surface the action's own "pending request exists" error).

import 'server-only'
import { getServerSupabase } from '@foundations/data/supabase'
import { getSessionUser } from '@foundations/auth/guards'
import { loggerFor } from '@foundations/log/pino'

const log = loggerFor({ component: 'payouts.getPendingPayoutRequest' })

export type PendingPayoutRequest = {
  id: number
  amount_cents: number
  currency: string
  status: 'pending'
  payout_method_kind: 'paypal'
  payout_method_target_masked: string
  created_at: string
}

/**
 * Read the partner's most-recent pending payout request. Returns
 * null when no pending request exists.
 *
 * Pair with `requestPayoutAction`'s `pending_request_exists` error
 * code — this query is the read-side hint for the UI ("you already
 * have a pending request"), the action is the write-side guard.
 */
export async function getPendingPayoutRequest(): Promise<PendingPayoutRequest | null> {
  const user = await getSessionUser()
  if (!user) return null

  const supabase = await getServerSupabase()

  // Look up the partner row first (matches the pattern from
  // getPartnerLedger — partner_id is the join key).
  const { data: partner } = await supabase
    .from('partners')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!partner) return null
  const partnerId = (partner as { id: number }).id

  // Read the partner's most-recent pending payout request. We sort
  // by (created_at desc, id desc) and take 1 — in practice a partner
  // should have at most one pending row (the action enforces it),
  // but a defensive newest-first read is cheap.
  const { data, error } = await supabase
    .from('payout_requests')
    .select('id, amount_cents, currency, status, payout_method_kind, payout_method_target_masked, created_at')
    .eq('partner_id', partnerId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    log.warn(
      { partner_id_hash: hashPartnerId(partnerId), code: 'pending_request_read_failed' },
      'pending payout request read failed',
    )
    return null
  }
  if (!data) return null
  const row = data as {
    id: number
    amount_cents: number | null
    currency: string | null
    status: string | null
    payout_method_kind: string | null
    payout_method_target_masked: string | null
    created_at: string | null
  }
  // Defensive mapping — the DB CHECK enforces all of these are non-
  // null + valid, but if a future migration regresses the constraint,
  // we fail closed (return null) rather than handing the UI a broken
  // shape.
  if (
    typeof row.amount_cents !== 'number' ||
    typeof row.currency !== 'string' ||
    row.status !== 'pending' ||
    row.payout_method_kind !== 'paypal' ||
    typeof row.payout_method_target_masked !== 'string' ||
    typeof row.created_at !== 'string'
  ) {
    return null
  }
  return {
    id: row.id,
    amount_cents: row.amount_cents,
    currency: row.currency,
    status: 'pending',
    payout_method_kind: 'paypal',
    payout_method_target_masked: row.payout_method_target_masked,
    created_at: row.created_at,
  }
}

/** FNV-1a 32-bit hash of the numeric partner_id for PII-safe logs. */
function hashPartnerId(partnerId: number): string {
  let hash = 0x811c9dc5
  for (const ch of String(partnerId)) {
    hash ^= ch.charCodeAt(0)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}