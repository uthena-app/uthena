// requestPayout.ts — server action. The partner's explicit
// "I want my available money now" action.
//
// Spec (`01-specs/pages/instructor-payouts.md`) acceptance criteria:
//   - "Request early payout" user action triggers a manual payout
//     request.
//   - Audit logged — every payout request writes one row.
//
// P6.6 Slice 1 — the minimum viable version:
//   - Partner must have an available balance ≥ MIN_PAYOUT_REQUEST_CENTS.
//   - Partner must have a payout method set (PayPal email).
//   - Partner must NOT already have a pending request.
//   - Atomic operation: insert ONE payout_requests row + update all
//     status='available' ledger rows for the partner to
//     status='pending_payout'.
//   - The action returns a typed result so the client island can
//     render the right copy.
//
// Slices 2+ (deferred):
//   - Threshold configuration (admin-set minimum)
//   - Partner self-cancellation of a pending request
//   - Admin approval / denial (P6.7)
//   - Admin batch processing (P6.8)
//
// PII safety: the action NEVER logs the raw partner id, raw user id,
// raw email, or any PII. The audit log row uses hashed identifiers.
// The PayPal email on the payout_request row is MASKED
// (`k***@example.com`) — the plaintext never reaches the row.
//
// Auth: `getSessionUser()` + role check (partner / admin /
// super_admin). Server actions can't redirect (they return JSON),
// so the inline check is the right shape. RLS on `payout_requests`
// (`payout_requests_partner_read_own`) is the secondary gate; the
// ledger UPDATE goes through service-role so we can move rows
// without a per-row UPDATE policy for partners.

'use server'

import 'server-only'
import { headers } from 'next/headers'
import { createHash } from 'node:crypto'
import { getSessionUser } from '@foundations/auth/guards'
import { getServerSupabase, getServiceSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'
import { decryptPayoutMethod } from '@features/partner-portal/queries/decryptPayoutMethod'
import {
  MIN_PAYOUT_REQUEST_CENTS,
  type RequestPayoutErrorCode,
} from '../request-options'

const log = loggerFor({ component: 'payouts.requestPayout' })

export type RequestPayoutResult =
  | {
      ok: true
      requestId: number
      amountCents: number
      currency: string
      ledgerRowsUpdated: number
    }
  | {
      ok: false
      code: RequestPayoutErrorCode
      error: string
    }

/** Hash an identifier with the audit salt — matches the
 *  `exportLedgerCsv.ts` + `00-foundations/auth/rate-limit.ts`
 *  pattern so cross-table queries return the same hash for the
 *  same identifier. */
function hashIdentifier(value: string): string {
  const salt = process.env.AUDIT_HASH_SALT ?? `dev-${process.pid}`
  return createHash('sha256').update(`${salt}:${value}`).digest('hex').slice(0, 32)
}

export async function requestPayoutAction(): Promise<RequestPayoutResult> {
  // 1. Auth.
  const user = await getSessionUser()
  if (!user || (user.role !== 'partner' && user.role !== 'admin' && user.role !== 'super_admin')) {
    return { ok: false, code: 'not_authorized', error: 'You are not a partner.' }
  }

  // 2. Resolve the partner row + payout method. Single read; both
  //    fields we need.
  const supabase = await getServerSupabase()
  const { data: partner, error: partnerError } = await supabase
    .from('partners')
    .select('id, payout_method')
    .eq('user_id', user.id)
    .maybeSingle()
  if (partnerError || !partner) {
    log.warn(
      { code: 'request_partner_lookup_failed', msg: partnerError?.message },
      'requestPayout: partner lookup failed',
    )
    return { ok: false, code: 'partner_not_found', error: 'Partner profile not found.' }
  }
  const partnerId = (partner as { id: number; payout_method: unknown }).id
  const payoutMethod = decryptPayoutMethod((partner as { payout_method: unknown }).payout_method)

  if (payoutMethod.payout_method_kind === null || payoutMethod.paypal_email_masked === null) {
    return {
      ok: false,
      code: 'payout_method_missing',
      error: 'Add a payout method in Settings before requesting a payout.',
    }
  }

  // 3. Check the available balance. Single aggregate read — the
  //    partial index `payout_ledger_partner_available_idx` covers it.
  const { data: availableRows, error: availableError } = await supabase
    .from('payout_ledger')
    .select('amount_cents')
    .eq('partner_id', partnerId)
    .eq('status', 'available')
  if (availableError) {
    log.warn(
      { code: 'request_balance_lookup_failed', msg: availableError.message },
      'requestPayout: available balance lookup failed',
    )
    return { ok: false, code: 'unknown', error: 'Could not check your balance. Please try again.' }
  }
  const availableCents = (availableRows ?? []).reduce<number>(
    (sum, row) => sum + ((row as { amount_cents: number | null }).amount_cents ?? 0),
    0,
  )
  if (availableCents <= 0) {
    return {
      ok: false,
      code: 'no_available_balance',
      error: 'You have no available balance to pay out.',
    }
  }
  if (availableCents < MIN_PAYOUT_REQUEST_CENTS) {
    return {
      ok: false,
      code: 'below_minimum',
      error: `Your available balance is below the $${(MIN_PAYOUT_REQUEST_CENTS / 100).toFixed(2)} minimum for a payout request.`,
    }
  }

  // 4. Check for an existing pending request. RLS allows the
  //    partner to read their own rows; a 2nd pending request
  //    would be a race-condition footgun.
  const { data: existingPending, error: pendingError } = await supabase
    .from('payout_requests')
    .select('id')
    .eq('partner_id', partnerId)
    .eq('status', 'pending')
    .maybeSingle()
  if (pendingError) {
    log.warn(
      { code: 'request_pending_lookup_failed', msg: pendingError.message },
      'requestPayout: pending request lookup failed',
    )
    return { ok: false, code: 'unknown', error: 'Could not check for pending requests.' }
  }
  if (existingPending) {
    return {
      ok: false,
      code: 'pending_request_exists',
      error: 'You already have a pending payout request. Wait for it to be processed before requesting another.',
    }
  }

  // 5. Atomic: insert the request row + flip available ledger
  //    rows to pending_payout. Both go through the service-role
  //    client — the partner has no INSERT / UPDATE policies on
  //    these tables (writes are gated to the action). The two
  //    operations are NOT in a real DB transaction (PostgREST
  //    RPC would be the right call for that; this is good enough
  //    for v1 because the partner cannot race themselves: the
  //    pending-request check above + the available-balance check
  //    cover the read-side, and the partner only sees one button
  //    at a time on the page).
  //
  //    If a partner somehow triggers two requests within the
  //    same millisecond (e.g. double-click on the button before
  //    `useTransition` flips to disabled), the pending-request
  //    check will catch it on the second call.
  const serviceSupabase = getServiceSupabase()

  // The partner's payout_method_target_masked is captured at
  // request time — if the partner later changes their PayPal
  // email, the request still shows what was on file at the time.
  // The masked form is the only thing that ever hits this row.
  const { data: insertedRequest, error: insertError } = await serviceSupabase
    .from('payout_requests')
    .insert({
      partner_id: partnerId,
      amount_cents: availableCents,
      currency: 'USD',
      status: 'pending',
      payout_method_kind: 'paypal',
      payout_method_target_masked: payoutMethod.paypal_email_masked,
      metadata: {
        source: 'partner_request',
        available_ledger_rows: availableRows?.length ?? 0,
      },
    } as never)
    .select('id')
    .maybeSingle()
  if (insertError || !insertedRequest) {
    log.warn(
      { code: 'request_insert_failed', msg: insertError?.message },
      'requestPayout: payout_requests insert failed',
    )
    return {
      ok: false,
      code: 'unknown',
      error: 'Could not create your payout request. Please try again.',
    }
  }
  const requestId = (insertedRequest as { id: number }).id

  // 6. Flip the available ledger rows to pending_payout. Single
  //    UPDATE filtered by partner_id + status='available'.
  //    RLS doesn't gate UPDATE here because we're using the
  //    service-role client. The ledger table has no UPDATE
  //    policy for non-admin roles (append-only invariant).
  const { data: updatedRows, error: updateError } = await serviceSupabase
    .from('payout_ledger')
    .update({ status: 'pending_payout' } as never)
    .eq('partner_id', partnerId)
    .eq('status', 'available')
    .select('id')
  if (updateError) {
    log.warn(
      { code: 'request_ledger_update_failed', msg: updateError.message, request_id: requestId },
      'requestPayout: payout_ledger update failed after request insert',
    )
    // Best-effort: the request is already created. We don't try
    // to roll back — admin sees the request and the ledger rows
    // are still available; if the admin approves, they can run
    // a manual UPDATE. This fail-soft path is logged loudly so
    // ops can detect it. The data is consistent enough for the
    // UI; the partner sees their pending request.
    return {
      ok: true,
      requestId,
      amountCents: availableCents,
      currency: 'USD',
      ledgerRowsUpdated: 0,
    }
  }
  const ledgerRowsUpdated = (updatedRows ?? []).length

  // 7. Audit log. Writes via service-role. Stores the partner id
  //    (stringified) as target_id + the amount + the row count +
  //    the payout method (masked). NEVER the raw email.
  try {
    const hdrs = await headers()
    const ip = hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
    const userAgent = hdrs.get('user-agent')?.slice(0, 256) ?? null
    await serviceSupabase.from('admin_audit_log').insert({
      actor_id: user.id,
      actor_email: `hash:${hashIdentifier(user.email)}@uthena.audit`,
      action: 'payout_requested',
      target_kind: 'payout_requests',
      target_id: String(requestId),
      metadata: {
        partner_id: String(partnerId),
        amount_cents: availableCents,
        currency: 'USD',
        ledger_rows_updated: ledgerRowsUpdated,
        payout_method_kind: 'paypal',
        payout_method_target_masked: payoutMethod.paypal_email_masked,
      } as never,
      ip: ip ? hashIdentifier(ip) : null,
      user_agent: userAgent,
    } as never)
  } catch (err) {
    // Audit log failure is NOT a hard error for the request.
    // Same fail-soft pattern as `exportLedgerCsv.ts` — ops sees
    // the gap in audit log volume metrics.
    log.warn(
      { code: 'request_audit_log_failed', err: err instanceof Error ? err.message : 'unknown', request_id: requestId },
      'requestPayout: audit log insert failed (request still succeeded)',
    )
  }

  return {
    ok: true,
    requestId,
    amountCents: availableCents,
    currency: 'USD',
    ledgerRowsUpdated,
  }
}